/**
 * AI Model pricing and cost calculation utility.
 * Prices in USD per 1M tokens (as of 2026-02).
 */

export const AI_MODEL_PRICING = {
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
} as const;

export type AIModel = keyof typeof AI_MODEL_PRICING;

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = AI_MODEL_PRICING[model as AIModel];
  if (!pricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/** Monthly budget in KRW */
export const MONTHLY_BUDGET_KRW = 1_000_000;

/** Approximate USD to KRW exchange rate */
export const USD_TO_KRW = 1_450;

/** AI usage purpose constants */
export const AI_PURPOSES = {
  WEB_ANALYSIS: 'web_analysis',
  IMAGE_OCR: 'image_ocr',
  SCORING: 'scoring',
  EMAIL_GENERATION: 'email_generation',
  RESPONSE_ANALYSIS: 'response_analysis',
  TONE_ADAPTATION: 'tone_adaptation',
} as const;
export type AIPurpose = (typeof AI_PURPOSES)[keyof typeof AI_PURPOSES];
