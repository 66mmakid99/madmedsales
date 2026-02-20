import type { ReactNode } from 'react';
import { usePipeline } from '../../hooks/use-dashboard';
import { useLeads } from '../../hooks/use-leads';
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

const GRADE_COLORS: Record<string, string> = {
  S: 'border-red-400 bg-red-50',
  A: 'border-orange-400 bg-orange-50',
  B: 'border-blue-400 bg-blue-50',
  C: 'border-gray-400 bg-gray-50',
};

const GRADE_BADGE: Record<string, string> = {
  S: 'bg-red-500 text-white',
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-500 text-white',
};

const INTEREST_DOT: Record<string, string> = {
  hot: 'bg-red-500',
  warm: 'bg-orange-400',
  warming: 'bg-yellow-400',
  cold: 'bg-blue-400',
};

export function PipelineBoard(): ReactNode {
  const { data: pipelineData, loading: pipelineLoading } = usePipeline();
  const { data: leadsData, loading: leadsLoading } = useLeads({ limit: 200 });

  const loading = pipelineLoading || leadsLoading;
  const leads = leadsData?.leads ?? [];
  const stages = pipelineData?.stages ?? {};

  const leadsByStage: Record<string, typeof leads> = {};
  for (const lead of leads) {
    if (!leadsByStage[lead.stage]) {
      leadsByStage[lead.stage] = [];
    }
    leadsByStage[lead.stage].push(lead);
  }

  if (loading) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-bold text-gray-900">파이프라인</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-64 w-56 shrink-0 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold text-gray-900">파이프라인</h2>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {LEAD_STAGES.map((stage) => {
          const count = stages[stage] ?? 0;
          const stageLeads = leadsByStage[stage] ?? [];
          return (
            <div key={stage} className="w-56 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  {STAGE_LABELS[stage] ?? stage}
                </h3>
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {count}
                </span>
              </div>
              <div className="max-h-[calc(100vh-200px)] space-y-2 overflow-y-auto rounded-lg bg-gray-100 p-2">
                {stageLeads.length === 0 && (
                  <p className="py-4 text-center text-xs text-gray-400">없음</p>
                )}
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className={`rounded-lg border-l-4 bg-white p-3 shadow-sm ${GRADE_COLORS[lead.grade ?? ''] ?? 'border-gray-300'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${GRADE_BADGE[lead.grade ?? ''] ?? 'bg-gray-200 text-gray-700'}`}>
                        {lead.grade ?? '-'}
                      </span>
                      <span className="truncate text-xs font-medium text-gray-800">
                        {lead.contact_name ?? '미정'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${INTEREST_DOT[lead.interest_level] ?? 'bg-gray-300'}`} />
                      <span className="text-[10px] text-gray-500">{lead.interest_level}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
