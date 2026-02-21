// v1.0 - 2026-02-20
// Reply analysis service using Claude Haiku

import {
  buildReplyAnalysisPrompt,
  type ReplyAnalysisOutput,
} from './prompts/reply-analysis';
import { logAiUsage } from './usage-logger';
import { createSupabaseClient } from '../../lib/supabase';

interface AnalyzerEnv {
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface OurEmail {
  subject: string;
  summary: string;
}

const VALID_SENTIMENTS = ['positive', 'neutral', 'negative', 'question'] as const;
const VALID_INTENTS = ['high', 'medium', 'low', 'none'] as const;
const VALID_REPLY_TYPES = ['inquiry', 'interest', 'objection', 'request', 'rejection', 'other'] as const;
const VALID_URGENCIES = ['immediate', 'today', 'normal', 'low'] as const;

function isValidReplyAnalysis(value: unknown): value is ReplyAnalysisOutput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  return (
    VALID_SENTIMENTS.includes(obj['sentiment'] as typeof VALID_SENTIMENTS[number]) &&
    VALID_INTENTS.includes(obj['purchase_intent'] as typeof VALID_INTENTS[number]) &&
    VALID_REPLY_TYPES.includes(obj['reply_type'] as typeof VALID_REPLY_TYPES[number]) &&
    typeof obj['summary'] === 'string' &&
    typeof obj['recommended_response'] === 'string' &&
    typeof obj['should_connect_kakao'] === 'boolean' &&
    typeof obj['should_notify_admin'] === 'boolean' &&
    VALID_URGENCIES.includes(obj['urgency'] as typeof VALID_URGENCIES[number])
  );
}

function extractTextContent(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid API response format');
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['content'])) {
    throw new Error('Missing content in response');
  }
  for (const block of obj['content'] as unknown[]) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>)['type'] === 'text'
    ) {
      return (block as Record<string, unknown>)['text'] as string;
    }
  }
  throw new Error('No text block in response');
}

export async function analyzeReply(
  env: AnalyzerEnv,
  ourEmail: OurEmail,
  replyContent: string
): Promise<ReplyAnalysisOutput> {
  const prompt = buildReplyAnalysisPrompt({
    ourEmailSubject: ourEmail.subject,
    ourEmailSummary: ourEmail.summary,
    replyContent,
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errText}`);
    }

    const data: unknown = await response.json();

    // Extract and log token usage
    const usage = (data as Record<string, unknown>)['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      const supabase = createSupabaseClient(env);
      await logAiUsage(supabase, {
        service: 'claude',
        model: 'claude-haiku-4-5',
        purpose: 'reply_analysis',
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
      });
    }

    const text = extractTextContent(data);
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in reply analysis response');
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!isValidReplyAnalysis(parsed)) {
      throw new Error('Invalid reply analysis structure');
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Reply analysis failed: ${message}`);
  }
}
