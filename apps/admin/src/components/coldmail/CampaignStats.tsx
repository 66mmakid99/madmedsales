import type { ReactNode } from 'react';
import type { EmailCampaign } from '@madmedsales/shared';

interface CampaignStatsProps {
  campaign: EmailCampaign;
}

export function CampaignStats({ campaign }: CampaignStatsProps): ReactNode {
  const total = campaign.total_count || 1;
  const pendingCount = campaign.pending_count
    ?? Math.max(0, campaign.total_count - campaign.approved_count - campaign.rejected_count - campaign.sent_count);
  const draftFailedCount = campaign.draft_failed_count ?? 0;
  const draftReadyCount = pendingCount - draftFailedCount;

  const segments = [
    { label: '발송됨', count: campaign.sent_count,    bg: 'bg-green-500',  text: 'text-green-700' },
    { label: '승인',   count: campaign.approved_count, bg: 'bg-blue-500',   text: 'text-blue-700' },
    { label: '검토 대기', count: draftReadyCount,      bg: 'bg-gray-300',   text: 'text-gray-600' },
    { label: '초안 실패', count: draftFailedCount,     bg: 'bg-orange-400', text: 'text-orange-600' },
    { label: '반려',   count: campaign.rejected_count, bg: 'bg-red-400',    text: 'text-red-600' },
  ];

  // AI 초안 완료율 (draft_count / total)
  const draftPct = campaign.total_count > 0
    ? Math.round(((campaign.total_count - pendingCount) / campaign.total_count) * 100)
    : 0;

  return (
    <div className="space-y-3">
      {/* 메인 프로그레스 바 */}
      <div>
        <div className="mb-1.5 flex h-2.5 overflow-hidden rounded-full bg-gray-100">
          {segments.map(s =>
            s.count > 0 ? (
              <div key={s.label}
                className={`${s.bg} transition-all`}
                style={{ width: `${(s.count / total) * 100}%` }}
                title={`${s.label}: ${s.count}건`} />
            ) : null,
          )}
        </div>

        {/* 범례 */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {segments.filter(s => s.count > 0).map(s => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${s.bg}`} />
              <span className={`text-xs ${s.text}`}>{s.label} <strong>{s.count}</strong></span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-gray-400">총</span>
            <span className="text-xs font-semibold text-gray-700">{campaign.total_count}건</span>
          </div>
        </div>
      </div>

      {/* AI 초안 완료율 + 발송 진행률 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-gray-100 bg-white p-2">
          <p className="text-[10px] text-gray-400 mb-1">AI 초안 + 관리자 검토</p>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="bg-blue-400 transition-all" style={{ width: `${draftPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-600">
            <span className="font-semibold text-blue-600">{draftPct}%</span>
            <span className="ml-1 text-gray-400">({campaign.total_count - pendingCount}/{campaign.total_count}건)</span>
          </p>
        </div>
        <div className="rounded border border-gray-100 bg-white p-2">
          <p className="text-[10px] text-gray-400 mb-1">발송 진행률</p>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="bg-green-500 transition-all"
              style={{ width: `${Math.round((campaign.sent_count / total) * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-600">
            <span className="font-semibold text-green-600">
              {Math.round((campaign.sent_count / total) * 100)}%
            </span>
            <span className="ml-1 text-gray-400">({campaign.sent_count}/{campaign.total_count}건)</span>
          </p>
        </div>
      </div>
    </div>
  );
}
