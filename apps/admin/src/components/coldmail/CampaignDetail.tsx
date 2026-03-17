import type { ReactNode } from 'react';
import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import type { EmailCampaign, CampaignEmail } from '@madmedsales/shared';
import { useApi } from '../../hooks/use-api';
import { apiFetch } from '../../lib/api';
import { CampaignStats } from './CampaignStats';
import { EmailPreviewPanel } from './EmailPreviewPanel';

const STATUS_LABEL: Record<string, string> = {
  pending: '검토 대기', approved: '승인', rejected: '반려',
  sent: '발송됨', bounced: '반송', failed: '실패',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600',
  sent: 'bg-green-100 text-green-700',
  bounced: 'bg-orange-100 text-orange-600',
  failed: 'bg-red-100 text-red-600',
};
const CAMP_STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', reviewing: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700', sending: 'bg-green-100 text-green-700',
  completed: 'bg-green-200 text-green-800', paused: 'bg-red-100 text-red-700',
};
const CAMP_STATUS_LABEL: Record<string, string> = {
  draft: '초안', reviewing: '검토 중', approved: '승인됨',
  sending: '발송 중', completed: '완료', paused: '일시정지',
};

const PAGE_SIZE = 50;

// ─── 타겟 필터 배지 ────────────────────────────────────
function TargetBadges({ filter }: { filter: Record<string, unknown> }): ReactNode {
  const badges: string[] = [];
  if (filter.sido) badges.push(`📍 ${String(filter.sido)}`);
  if (filter.sigungu) badges.push(String(filter.sigungu));
  if (filter.confidence_min) badges.push(`신뢰도 ${String(filter.confidence_min)}%↑`);
  if (filter.email_type) badges.push(String(filter.email_type));
  if (filter.department) badges.push(String(filter.department));
  if (badges.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {badges.map(b => (
        <span key={b} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{b}</span>
      ))}
    </div>
  );
}

// ─── 이메일 상태 + 반응 배지 ───────────────────────────
function EmailStatusCell({ email }: { email: CampaignEmail }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[email.status] ?? ''}`}>
        {STATUS_LABEL[email.status] ?? email.status}
      </span>
      {email.status === 'sent' && (
        <div className="flex gap-1">
          {email.opened_at && (
            <span className="rounded bg-green-50 px-1 py-0.5 text-[10px] font-medium text-green-700">열람</span>
          )}
          {email.clicked_at && (
            <span className="rounded bg-purple-50 px-1 py-0.5 text-[10px] font-medium text-purple-700">클릭</span>
          )}
          {email.bounced_at && (
            <span className="rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-600">반송</span>
          )}
          {!email.opened_at && !email.clicked_at && !email.bounced_at && (
            <span className="text-[10px] text-gray-300">반응없음</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 메인 ─────────────────────────────────────────────
export function CampaignDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewEmail, setPreviewEmail] = useState<CampaignEmail | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const { data: campaign, refetch: refetchCampaign } = useApi<EmailCampaign>(id ? `/api/campaigns/${id}` : null);
  const emailParams = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (statusFilter) emailParams.set('status', statusFilter);
  const { data: emailData, refetch: refetchEmails } = useApi<{ emails: CampaignEmail[]; total: number }>(
    id ? `/api/campaigns/${id}/emails?${emailParams.toString()}` : null,
  );

  const refresh = useCallback(() => { void refetchCampaign(); void refetchEmails(); }, [refetchCampaign, refetchEmails]);

  function toggleSelect(emailId: string): void {
    setSelectedIds(prev => { const next = new Set(prev); next.has(emailId) ? next.delete(emailId) : next.add(emailId); return next; });
  }
  function toggleSelectAll(): void {
    if (!emailData?.emails) return;
    const allIds = emailData.emails.map(e => e.id);
    setSelectedIds(selectedIds.size === allIds.length ? new Set() : new Set(allIds));
  }

  async function handleBulkApprove(): Promise<void> {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택된 ${selectedIds.size}건을 승인하시겠습니까?`)) return;
    try {
      await apiFetch(`/api/campaigns/${id}/emails/bulk-approve`, { method: 'POST', body: JSON.stringify({ ids: Array.from(selectedIds) }) });
      setSelectedIds(new Set()); refresh();
    } catch (err) { alert(`일괄 승인 실패: ${String(err)}`); }
  }

  async function handleBulkReject(): Promise<void> {
    if (selectedIds.size === 0) return;
    const note = prompt(`선택된 ${selectedIds.size}건의 반려 사유를 입력하세요:`);
    if (note === null) return;
    setRejecting(true);
    try {
      await apiFetch(`/api/campaigns/${id}/emails/bulk-reject`, { method: 'POST', body: JSON.stringify({ ids: Array.from(selectedIds), admin_note: note || '일괄 반려' }) });
      setSelectedIds(new Set()); refresh();
    } catch (err) { alert(`일괄 반려 실패: ${String(err)}`); }
    finally { setRejecting(false); }
  }

  async function handleCampaignApprove(): Promise<void> {
    if (!campaign || !confirm('캠페인 전체를 승인하시겠습니까?\n승인 후 발송 스크립트를 실행해야 합니다.')) return;
    setApproving(true);
    try { await apiFetch(`/api/campaigns/${id}/approve`, { method: 'POST' }); refresh(); }
    catch (err) { alert(`캠페인 승인 실패: ${String(err)}`); }
    finally { setApproving(false); }
  }

  if (!campaign) return <div className="flex h-full items-center justify-center text-gray-400">로딩 중...</div>;

  const emails = emailData?.emails ?? [];
  const totalEmails = emailData?.total ?? 0;
  const totalPages = Math.ceil(totalEmails / PAGE_SIZE);
  const pendingCount = campaign.pending_count ?? Math.max(0, campaign.total_count - campaign.approved_count - campaign.rejected_count - campaign.sent_count);
  const draftFailedCount = campaign.draft_failed_count ?? 0;
  const canApproveCampaign = campaign.status === 'reviewing' && campaign.approved_count > 0;

  const statusCounts: Record<string, number> = {
    '': campaign.total_count,
    pending: pendingCount,
    approved: campaign.approved_count,
    rejected: campaign.rejected_count,
    sent: campaign.sent_count,
  };

  return (
    <div className="flex h-full">
      <div className={`flex flex-col ${previewEmail ? 'flex-1' : 'w-full'}`}>

        {/* 헤더 */}
        <div className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="mb-1 flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAMP_STATUS_COLOR[campaign.status] ?? ''}`}>
                  {CAMP_STATUS_LABEL[campaign.status] ?? campaign.status}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-gray-500">{campaign.purpose}</p>
              <TargetBadges filter={campaign.target_filter} />
            </div>
            <div className="flex items-center gap-2 ml-4">
              {canApproveCampaign && (
                <button onClick={handleCampaignApprove} disabled={approving}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {approving ? '처리 중...' : '캠페인 전체 승인'}
                </button>
              )}
              {campaign.status === 'approved' && (
                <div className="rounded bg-green-50 px-3 py-1.5 text-sm text-green-700">
                  ✅ 승인 완료 — send-campaign.ts --execute 실행
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI 초안 실패 경고 */}
        {draftFailedCount > 0 && (
          <div className="flex items-center gap-2 border-l-4 border-orange-400 bg-orange-50 px-5 py-2.5 text-sm text-orange-800">
            <span className="text-base">⚠️</span>
            <div>
              <span className="font-semibold">AI 초안 생성 실패 {draftFailedCount}건</span>
              <span className="ml-2 text-orange-600">— 재시도 필요:</span>
              <code className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-xs">
                npx tsx scripts/coldmail/draft-campaign.ts --campaign-id {id}
              </code>
            </div>
          </div>
        )}

        {/* 통계 */}
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
          <CampaignStats campaign={campaign} />
        </div>

        {/* 필터 탭 + 일괄 처리 */}
        <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-6 py-2">
          {(['', 'pending', 'approved', 'rejected', 'sent'] as const).map(s => (
            <button key={s}
              onClick={() => { setStatusFilter(s); setPage(0); setSelectedIds(new Set()); }}
              className={`rounded px-3 py-1 text-sm transition-colors ${statusFilter === s ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {s === '' ? '전체' : STATUS_LABEL[s] ?? s}
              <span className="ml-1 text-xs opacity-60">({statusCounts[s] ?? 0})</span>
            </button>
          ))}
          <div className="flex-1" />
          {totalEmails > 0 && (
            <span className="text-xs text-gray-400 mr-2">{statusFilter ? `${STATUS_LABEL[statusFilter] ?? statusFilter} ` : ''}{totalEmails}건</span>
          )}
          {selectedIds.size > 0 && (
            <>
              <button onClick={handleBulkApprove}
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
                {selectedIds.size}건 승인
              </button>
              <button onClick={handleBulkReject} disabled={rejecting}
                className="rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                {selectedIds.size}건 반려
              </button>
            </>
          )}
        </div>

        {/* 이메일 목록 */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">
                  <input type="checkbox"
                    checked={emails.length > 0 && selectedIds.size === emails.length}
                    onChange={toggleSelectAll} />
                </th>
                <th className="px-4 py-2 text-left">병원 / 원장</th>
                <th className="px-4 py-2 text-left">지역</th>
                <th className="px-4 py-2 text-left">이메일</th>
                <th className="px-4 py-2 text-left">제목</th>
                <th className="px-4 py-2 text-left">상태 / 반응</th>
                <th className="px-4 py-2 text-left">발송일시</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {emails.map(email => (
                <tr key={email.id}
                  className={`cursor-pointer hover:bg-gray-50 ${previewEmail?.id === email.id ? 'bg-blue-50' : ''}`}
                  onClick={() => setPreviewEmail(email)}>
                  <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(email.id)} onChange={() => toggleSelect(email.id)} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="max-w-[140px]">
                      <p className="truncate font-medium text-gray-900">{email.hospital_name}</p>
                      {email.director_name && (
                        <p className="truncate text-xs text-gray-400">{email.director_name} 원장</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {[email.hospital_sido, email.hospital_sigungu].filter(Boolean).join(' ')}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-2 text-gray-600 text-xs">{email.to_email}</td>
                  <td className="px-4 py-2">
                    {email.subject
                      ? <span className="block max-w-[200px] truncate text-gray-700">{email.subject}</span>
                      : email.admin_note === 'draft_failed'
                        ? <span className="text-xs text-orange-500 font-medium">⚠️ 초안 실패</span>
                        : <span className="text-xs italic text-gray-300">초안 없음</span>
                    }
                  </td>
                  <td className="px-4 py-2"><EmailStatusCell email={email} /></td>
                  <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                    {email.sent_at ? new Date(email.sent_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </td>
                  <td className="px-4 py-2">
                    <button className="text-xs text-blue-500 hover:underline"
                      onClick={e => { e.stopPropagation(); setPreviewEmail(email); }}>
                      보기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {emails.length === 0 && <div className="py-16 text-center text-gray-400">이메일 없음</div>}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-gray-200 py-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 text-gray-500 disabled:opacity-30">←</button>
            <span className="text-sm text-gray-600">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 text-gray-500 disabled:opacity-30">→</button>
          </div>
        )}
      </div>

      {/* 미리보기 패널 */}
      {previewEmail && (
        <div className="w-[440px] flex-shrink-0 border-l border-gray-200 bg-white">
          <EmailPreviewPanel campaignId={id!} email={previewEmail}
            onClose={() => setPreviewEmail(null)}
            onUpdate={() => { setPreviewEmail(null); refresh(); }} />
        </div>
      )}
    </div>
  );
}
