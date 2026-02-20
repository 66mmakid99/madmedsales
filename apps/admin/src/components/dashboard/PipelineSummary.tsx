import type { ReactNode } from 'react';
import { usePipeline } from '../../hooks/use-dashboard';
import { LEAD_STAGES } from '@madmedsales/shared';

const STAGE_LABELS: Record<string, string> = {
  new: '신규',
  contacted: '연락완료',
  responded: '응답',
  kakao_connected: '카카오 연결',
  demo_scheduled: '데모예정',
  demo_done: '데모완료',
  proposal: '제안',
  negotiation: '협상',
  closed_won: '성사',
  closed_lost: '실패',
  nurturing: '육성',
};

export function PipelineSummary(): ReactNode {
  const { data, loading, error } = usePipeline();

  if (loading) {
    return (
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">파이프라인</h3>
        <div className="h-40 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  const stages = data?.stages ?? {};
  const maxCount = Math.max(...Object.values(stages), 1);

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">파이프라인</h3>
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      <div className="space-y-2">
        {LEAD_STAGES.map((stage) => {
          const count = stages[stage] ?? 0;
          const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div key={stage} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-gray-600">
                {STAGE_LABELS[stage] ?? stage}
              </span>
              <div className="flex-1">
                <div className="h-5 rounded bg-gray-100">
                  <div
                    className="flex h-5 items-center rounded bg-blue-500 px-2 text-xs font-medium text-white transition-all"
                    style={{ width: `${Math.max(width, count > 0 ? 8 : 0)}%` }}
                  >
                    {count > 0 ? count : ''}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
