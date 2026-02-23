import type { ReactNode } from 'react';
import type { DataCollectionStats } from '../../hooks/use-dashboard';

interface Props {
  stats: DataCollectionStats;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b'];

export function DataCollectionChart({ stats }: Props): ReactNode {
  const items = [
    { label: '장비 보유 병원', ...stats.withEquipment, color: COLORS[0] },
    { label: '시술 보유 병원', ...stats.withTreatment, color: COLORS[1] },
    { label: '가격 보유 병원', ...stats.withPricing, color: COLORS[2] },
  ];

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-bold text-slate-800">데이터 수집 현황</h3>
      <div className="space-y-3">
        {items.map((d) => (
          <div key={d.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-slate-500">{d.label}</span>
              <span className="font-medium text-slate-800">{d.count.toLocaleString()}개 ({d.percentage}%)</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-gray-100">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{ width: `${d.percentage}%`, backgroundColor: d.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
