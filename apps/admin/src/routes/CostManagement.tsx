import type { ReactNode } from 'react';
import { CostSummaryCards } from '../components/costs/CostSummaryCards';
import { DailyCostChart } from '../components/costs/DailyCostChart';
import { PurposeBreakdown } from '../components/costs/PurposeBreakdown';
import { BudgetGauge } from '../components/costs/BudgetGauge';
import { useCostSummary, useDailyCosts, usePurposeCosts, useBudget } from '../hooks/use-costs';

export function CostManagement(): ReactNode {
  const summary = useCostSummary();
  const daily = useDailyCosts(30);
  const purposes = usePurposeCosts();
  const budget = useBudget();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">비용 관리</h2>
        <p className="text-sm text-gray-500">AI API 사용량 및 비용 추적</p>
      </div>

      <CostSummaryCards data={summary.data} loading={summary.loading} />

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <DailyCostChart data={daily.data} loading={daily.loading} />
        </div>
        <BudgetGauge data={budget.data} loading={budget.loading} />
      </div>

      <PurposeBreakdown data={purposes.data} loading={purposes.loading} />

      {summary.error && (
        <p className="text-sm text-red-500">Error: {summary.error}</p>
      )}
    </div>
  );
}
