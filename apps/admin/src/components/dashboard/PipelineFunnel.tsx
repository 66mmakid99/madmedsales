import type { ReactNode } from 'react';
import type { PipelineData } from '../../hooks/use-dashboard';

interface Props {
  pipeline: PipelineData;
}

interface Stage {
  key: keyof PipelineData;
  label: string;
  active: boolean;
}

const STAGES: Stage[] = [
  { key: 'phase1_collected', label: '수집', active: true },
  { key: 'phase2_profiled', label: '분석', active: true },
  { key: 'phase3_leads', label: '리드', active: false },
  { key: 'phase4_contacted', label: '접촉', active: false },
  { key: 'phase5_responded', label: '반응', active: false },
  { key: 'phase6_contracted', label: '계약', active: false },
];

export function PipelineFunnel({ pipeline }: Props): ReactNode {
  const maxVal = Math.max(pipeline.phase1_collected, 1);

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-bold text-slate-800">영업 퍼널</h3>
      <div className="space-y-2.5">
        {STAGES.map((stage, i) => {
          const val = pipeline[stage.key];
          const pct = (val / maxVal) * 100;
          const prevVal = i > 0 ? pipeline[STAGES[i - 1].key] : null;
          const convRate = prevVal && prevVal > 0 ? ((val / prevVal) * 100).toFixed(1) : null;

          return (
            <div key={stage.key}>
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${stage.active ? 'text-slate-800' : 'text-slate-400'}`}>
                    {stage.label}
                  </span>
                  {!stage.active && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-slate-400">활성화 예정</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {convRate !== null && i > 0 && (
                    <span className={`text-[10px] font-medium ${Number(convRate) < 1 ? 'text-red-500' : 'text-slate-400'}`}>
                      {convRate}%
                    </span>
                  )}
                  <span className={`text-sm font-bold ${stage.active ? 'text-slate-800' : 'text-slate-400'}`}>
                    {val.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-100">
                <div
                  className={`h-3 rounded-full transition-all ${stage.active ? 'bg-indigo-500' : 'bg-gray-200'}`}
                  style={{ width: `${Math.max(pct, val > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
