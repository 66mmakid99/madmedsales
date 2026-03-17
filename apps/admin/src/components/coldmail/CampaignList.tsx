import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EmailCampaign } from '@madmedsales/shared';
import { useApi } from '../../hooks/use-api';

const STATUS_LABEL: Record<string, string> = {
  draft: '초안', reviewing: '검토 중', approved: '승인됨',
  sending: '발송 중', completed: '완료', paused: '일시정지',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  reviewing: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  sending: 'bg-green-100 text-green-700',
  completed: 'bg-green-200 text-green-800',
  paused: 'bg-red-100 text-red-600',
};

interface CampaignListResult {
  campaigns: EmailCampaign[];
  total: number;
}

function CampaignCard({ camp }: { camp: EmailCampaign }): ReactNode {
  const navigate = useNavigate();
  const total = camp.total_count || 1;
  const pendingCount = Math.max(0, camp.total_count - camp.approved_count - camp.rejected_count - camp.sent_count);
  const draftReadyPct = Math.round(((camp.total_count - pendingCount) / total) * 100);
  const approvedPct  = Math.round((camp.approved_count / total) * 100);
  const sentPct      = Math.round((camp.sent_count / total) * 100);
  const rejectedPct  = Math.round((camp.rejected_count / total) * 100);

  // 타겟 배지
  const filter = camp.target_filter as Record<string, unknown>;
  const targetBadges: string[] = [];
  if (filter?.sido) targetBadges.push(String(filter.sido));
  if (filter?.confidence_min) targetBadges.push(`신뢰도 ${String(filter.confidence_min)}%↑`);

  return (
    <div onClick={() => navigate(`/coldmail/${camp.id}`)}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate font-medium text-gray-900">{camp.name}</div>
            <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[camp.status] ?? ''}`}>
              {STATUS_LABEL[camp.status] ?? camp.status}
            </span>
          </div>
          <div className="mt-0.5 text-sm text-gray-500">{camp.purpose}</div>
          {targetBadges.length > 0 && (
            <div className="mt-1 flex gap-1">
              {targetBadges.map(b => (
                <span key={b} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{b}</span>
              ))}
            </div>
          )}
        </div>
        <span className="ml-3 flex-shrink-0 text-xs text-gray-400">
          {new Date(camp.created_at).toLocaleDateString('ko-KR')}
        </span>
      </div>

      {/* 단계별 프로그레스 바 */}
      <div className="mb-1.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="bg-green-500 transition-all" style={{ width: `${sentPct}%` }} title={`발송됨 ${camp.sent_count}건`} />
          <div className="bg-blue-400 transition-all" style={{ width: `${approvedPct}%` }} title={`승인 ${camp.approved_count}건`} />
          <div className="bg-red-300 transition-all" style={{ width: `${rejectedPct}%` }} title={`반려 ${camp.rejected_count}건`} />
        </div>
        <div className="mt-1 flex gap-2 text-[10px] text-gray-400">
          {camp.sent_count > 0 && <span className="text-green-600">발송 {sentPct}%</span>}
          {camp.approved_count > 0 && <span className="text-blue-600">승인 {approvedPct}%</span>}
          {pendingCount > 0 && <span>대기 {pendingCount}건</span>}
          {camp.rejected_count > 0 && <span className="text-red-500">반려 {camp.rejected_count}건</span>}
        </div>
      </div>

      {/* AI 초안 완료율 */}
      {camp.status === 'reviewing' && (
        <div className="mt-1.5">
          <div className="flex h-1 overflow-hidden rounded-full bg-gray-100">
            <div className="bg-indigo-300" style={{ width: `${draftReadyPct}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-gray-400">초안 완료 {draftReadyPct}%</p>
        </div>
      )}

      {/* 통계 */}
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 border-t border-gray-50 pt-2">
        <span>총 {camp.total_count}건</span>
        {camp.daily_limit > 0 && <span className="text-gray-400">일 {camp.daily_limit}건 제한</span>}
        <span className="ml-auto text-blue-600">승인 {camp.approved_count}</span>
        <span className="text-green-600">발송 {camp.sent_count}</span>
        {camp.rejected_count > 0 && <span className="text-red-500">반려 {camp.rejected_count}</span>}
      </div>
    </div>
  );
}

export function CampaignList(): ReactNode {
  const [statusFilter, setStatusFilter] = useState('');

  const params = new URLSearchParams({ limit: '50' });
  if (statusFilter) params.set('status', statusFilter);

  const { data, loading, error } = useApi<CampaignListResult>(`/api/campaigns?${params.toString()}`);
  const campaigns = data?.campaigns ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">콜드메일 캠페인</h1>
            <p className="mt-0.5 text-sm text-gray-500">관리자 컨펌 기반 이메일 발송 파이프라인</p>
          </div>
          <div className="rounded-lg bg-blue-50 px-4 py-2 text-xs text-blue-700">
            <code>npx tsx scripts/coldmail/create-campaign.ts --execute</code>
          </div>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-1">
          {['', 'draft', 'reviewing', 'approved', 'sending', 'completed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`border-b-2 px-3 py-2.5 text-sm transition-colors ${
                statusFilter === s
                  ? 'border-blue-500 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {s === '' ? '전체' : STATUS_LABEL[s] ?? s}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {loading && <div className="text-center text-gray-400">로딩 중...</div>}
        {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</div>}
        {!loading && campaigns.length === 0 && (
          <div className="py-16 text-center">
            <div className="text-gray-400">캠페인이 없습니다.</div>
            <div className="mt-2 text-sm text-gray-400">
              CLI에서 <code className="rounded bg-gray-100 px-1">create-campaign.ts</code>로 생성하세요.
            </div>
          </div>
        )}
        <div className="space-y-3">
          {campaigns.map(camp => <CampaignCard key={camp.id} camp={camp} />)}
        </div>
      </div>
    </div>
  );
}
