import type { ReactNode } from 'react';
import type { CostSummary } from '../../hooks/use-costs';

interface Props {
  data: CostSummary | null;
  loading: boolean;
}

function Card({ title, value, sub, color }: { title: string; value: string; sub?: string; color: string }): ReactNode {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function formatKrw(value: number): string {
  if (value >= 10000) {
    return `₩${Math.round(value / 10000)}만`;
  }
  return `₩${value.toLocaleString()}`;
}

export function CostSummaryCards({ data, loading }: Props): ReactNode {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-gray-50" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card
        title="이번 달 총 비용"
        value={formatKrw(data.totalCostKrw)}
        sub={`$${data.totalCostUsd.toFixed(4)} · ${data.totalCalls}회 호출`}
        color="bg-white"
      />
      <Card
        title="Claude 비용"
        value={`$${data.claudeCostUsd.toFixed(4)}`}
        sub={`₩${Math.round(data.claudeCostUsd * 1450).toLocaleString()}`}
        color="bg-purple-50"
      />
      <Card
        title="Gemini 비용"
        value={`$${data.geminiCostUsd.toFixed(4)}`}
        sub={`₩${Math.round(data.geminiCostUsd * 1450).toLocaleString()}`}
        color="bg-blue-50"
      />
      <Card
        title="월 예산 잔여"
        value={formatKrw(data.budgetRemainingKrw)}
        sub={`${data.budgetUsedPercent}% 사용`}
        color={data.budgetUsedPercent > 80 ? 'bg-red-50' : 'bg-green-50'}
      />
    </div>
  );
}
