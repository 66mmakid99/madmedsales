/**
 * API usage logger for scripts (Node.js environment).
 * Logs token usage to Supabase api_usage_logs table.
 */
import { supabase } from './supabase.js';
import { calculateCost } from '@madmedsales/shared/src/ai-cost.js';

export interface LogApiUsageParams {
  service: 'gemini' | 'claude';
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  hospitalId?: string;
  leadId?: string;
  metadata?: Record<string, unknown>;
}

export async function logApiUsage(params: LogApiUsageParams): Promise<void> {
  const estimatedCostUsd = calculateCost(
    params.model,
    params.inputTokens,
    params.outputTokens
  );

  const { error } = await supabase.from('api_usage_logs').insert({
    service: params.service,
    model: params.model,
    purpose: params.purpose,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    hospital_id: params.hospitalId ?? null,
    lead_id: params.leadId ?? null,
    metadata: params.metadata ?? null,
  });

  if (error) {
    console.error('[usage-logger] Failed to log API usage:', error.message);
  }
}
