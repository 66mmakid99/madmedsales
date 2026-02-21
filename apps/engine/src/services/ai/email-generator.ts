// v1.0 - 2026-02-20
// Main email generation service using Claude AI

import type { EmailPromptInput } from './prompts/email-s';
import { buildSGradePrompt } from './prompts/email-s';
import { buildAGradePrompt } from './prompts/email-a';
import { buildBGradePrompt } from './prompts/email-b';
import { logAiUsage } from './usage-logger';
import { createSupabaseClient } from '../../lib/supabase';

const AI_MODELS = {
  S: 'claude-sonnet-4-5-20250929',
  A: 'claude-haiku-4-5-20251001',
  B: 'claude-haiku-4-5-20251001',
} as const;

const MAX_TOKENS = 1500;

export interface GenerateEmailInput {
  grade: 'S' | 'A' | 'B';
  hospitalName: string;
  doctorName: string | null;
  department: string | null;
  equipments: string[];
  treatments: string[];
  aiAnalysis: string | null;
  aiMessageDirection: string | null;
  stepNumber: number;
  stepPurpose: string;
  stepTone: string | null;
  stepKeyMessage: string | null;
  personalizationFocus: string | null;
  previousEmails: { subject: string; sentAt: string }[];
  leadId: string;
}

export interface GenerateEmailOutput {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  personalizationNotes: string;
  promptUsed: string;
  model: string;
}

interface Env {
  ANTHROPIC_API_KEY: string;
  WEB_URL: string;
  RESEND_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export async function generateUnsubscribeToken(
  leadId: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(leadId)
  );
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyUnsubscribeToken(
  leadId: string,
  token: string,
  secret: string
): Promise<boolean> {
  const expected = await generateUnsubscribeToken(leadId, secret);
  return expected === token;
}

function selectPromptBuilder(
  grade: 'S' | 'A' | 'B'
): (input: EmailPromptInput) => string {
  switch (grade) {
    case 'S':
      return buildSGradePrompt;
    case 'A':
      return buildAGradePrompt;
    case 'B':
      return buildBGradePrompt;
  }
}

function ensureUnsubscribeLink(html: string, url: string): string {
  if (html.includes(url)) {
    return html;
  }
  const unsubBlock = `<p style="font-size:11px;color:#999;margin-top:20px;">더 이상 수신을 원하지 않으시면 <a href="${url}" style="color:#999;">수신거부</a>를 클릭해주세요.</p>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${unsubBlock}</body>`);
  }
  return html + unsubBlock;
}

interface ParsedEmailResponse {
  subject: string;
  body_html: string;
  body_text: string;
  personalization_notes: string;
}

function isValidEmailResponse(value: unknown): value is ParsedEmailResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['subject'] === 'string' &&
    typeof obj['body_html'] === 'string' &&
    typeof obj['body_text'] === 'string' &&
    typeof obj['personalization_notes'] === 'string'
  );
}

export async function generateEmail(
  env: Env,
  input: GenerateEmailInput
): Promise<GenerateEmailOutput> {
  const unsubscribeUrl = `${env.WEB_URL}/api/public/unsubscribe?lead=${input.leadId}&token=${await generateUnsubscribeToken(input.leadId, env.RESEND_API_KEY)}`;

  const promptInput: EmailPromptInput = {
    hospitalName: input.hospitalName,
    doctorName: input.doctorName,
    department: input.department,
    equipments: input.equipments,
    treatments: input.treatments,
    aiAnalysis: input.aiAnalysis,
    aiMessageDirection: input.aiMessageDirection,
    stepNumber: input.stepNumber,
    stepPurpose: input.stepPurpose,
    stepTone: input.stepTone,
    stepKeyMessage: input.stepKeyMessage,
    personalizationFocus: input.personalizationFocus,
    previousEmails: input.previousEmails,
    unsubscribeUrl,
  };

  const buildPrompt = selectPromptBuilder(input.grade);
  const prompt = buildPrompt(promptInput);
  const model = AI_MODELS[input.grade];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
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
        model,
        purpose: 'email_generation',
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        leadId: input.leadId,
      });
    }

    const content = extractTextContent(data);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!isValidEmailResponse(parsed)) {
      throw new Error('Invalid email response structure from AI');
    }

    const bodyHtml = ensureUnsubscribeLink(parsed.body_html, unsubscribeUrl);

    return {
      subject: parsed.subject,
      bodyHtml,
      bodyText: parsed.body_text,
      personalizationNotes: parsed.personalization_notes,
      promptUsed: prompt,
      model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error';
    throw new Error(`Email generation failed: ${message}`);
  }
}

function extractTextContent(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid API response format');
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['content'])) {
    throw new Error('Missing content array in API response');
  }
  const blocks = obj['content'] as unknown[];
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>)['type'] === 'text'
    ) {
      return (block as Record<string, unknown>)['text'] as string;
    }
  }
  throw new Error('No text block found in API response');
}
