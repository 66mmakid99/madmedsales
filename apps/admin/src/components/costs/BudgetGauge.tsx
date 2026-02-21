import type { ReactNode } from 'react';
import type { BudgetData } from '../../hooks/use-costs';

interface Props {
  data: BudgetData | null;
  loading: boolean;
}

function formatKrw(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `₩${(value / 10000).toFixed(1)}만`;
  }
  return `₩${value.toLocaleString()}`;
}

export function BudgetGauge({ data, loading }: Props): ReactNode {
  if (loading || !data) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">월 예산 현황</h3>
        <div className="mt-4 h-32 animate-pulse rounded bg-gray-50" />
      </div>
    );
  }

  const barColor = data.usedPercent > 80
    ? 'bg-red-500'
    : data.usedPercent > 50
      ? 'bg-yellow-500'
      : 'bg-green-500';

  const projectedBarWidth = Math.min(
    (data.projectedMonthEndKrw / data.budgetKrw) * 100,
    100
  );

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-medium text-gray-700">월 예산 현황</h3>

      <div className="mt-4 space-y-3">
        {/* Budget bar */}
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>사용: {formatKrw(data.usedKrw)}</span>
            <span>예산: {formatKrw(data.budgetKrw)}</span>
          </div>
          <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(data.usedPercent, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">{data.usedPercent}% 사용됨</p>
        </div>

        {/* Projected */}
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>예상 월말: {formatKrw(data.projectedMonthEndKrw)}</span>
            {data.projectedOverBudget && (
              <span className="font-medium text-red-500">초과 예상!</span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${data.projectedOverBudget ? 'bg-red-300' : 'bg-blue-300'}`}
              style={{ width: `${projectedBarWidth}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          <div>일 평균: {formatKrw(data.dailyAvgKrw)}</div>
          <div>잔여: {formatKrw(data.remainingKrw)}</div>
          <div>진행: {data.dayOfMonth}/{data.daysInMonth}일</div>
          <div>잔여 일수: {data.daysInMonth - data.dayOfMonth}일</div>
        </div>
      </div>
    </div>
  );
}
