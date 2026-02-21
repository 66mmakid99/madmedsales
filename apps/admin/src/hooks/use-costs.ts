import { useApi } from './use-api';

export interface CostSummary {
  totalCostUsd: number;
  totalCostKrw: number;
  claudeCostUsd: number;
  geminiCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  budgetKrw: number;
  budgetRemainingKrw: number;
  budgetUsedPercent: number;
  byModel: Record<string, { calls: number; costUsd: number }>;
}

export interface DailyCost {
  date: string;
  claude: number;
  gemini: number;
  total: number;
  totalKrw: number;
}

export interface PurposeCost {
  purpose: string;
  calls: number;
  costUsd: number;
  costKrw: number;
  inputTokens: number;
  outputTokens: number;
}

export interface BudgetData {
  budgetKrw: number;
  usedKrw: number;
  remainingKrw: number;
  usedPercent: number;
  projectedMonthEndKrw: number;
  projectedOverBudget: boolean;
  dailyAvgKrw: number;
  dayOfMonth: number;
  daysInMonth: number;
}

export function useCostSummary() {
  return useApi<CostSummary>('/api/costs/summary');
}

export function useDailyCosts(days = 30) {
  return useApi<DailyCost[]>(`/api/costs/daily?days=${days}`);
}

export function usePurposeCosts() {
  return useApi<PurposeCost[]>('/api/costs/by-purpose');
}

export function useBudget() {
  return useApi<BudgetData>('/api/costs/budget');
}
