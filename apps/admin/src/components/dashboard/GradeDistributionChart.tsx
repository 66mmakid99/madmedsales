import type { ReactNode } from 'react';

interface Props {
  grades: Record<string, number>;
}

const GRADE_CONFIG: { key: string; label: string; color: string }[] = [
  { key: 'PRIME', label: 'PRIME', color: '#7C3AED' },
  { key: 'HIGH', label: 'HIGH', color: '#2563EB' },
  { key: 'MID', label: 'MID', color: '#059669' },
  { key: 'LOW', label: 'LOW', color: '#6B7280' },
];

export function GradeDistributionChart({ grades }: Props): ReactNode {
  const data = GRADE_CONFIG.map((g) => ({ ...g, count: grades[g.key] ?? 0 }));
  const maxVal = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">프로파일 등급 분포</h3>
        {total > 0 ? <span className="text-xs text-slate-400">{total}건</span> : null}
      </div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">등급 데이터 없음</p>
      ) : (
        <div className="space-y-3">
          {data.map((d) => {
            const pct = (d.count / maxVal) * 100;
            return (
              <div key={d.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold" style={{ color: d.color }}>{d.label}</span>
                  <span className="font-medium text-slate-800">{d.count}</span>
                </div>
                <div className="h-3 w-full rounded-full bg-gray-100">
                  <div
                    className="h-3 rounded-full transition-all"
                    style={{ width: `${Math.max(pct, d.count > 0 ? 4 : 0)}%`, backgroundColor: d.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
