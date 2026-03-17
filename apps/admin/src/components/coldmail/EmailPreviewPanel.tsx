import type { ReactNode } from 'react';
import { useState } from 'react';
import type { CampaignEmail } from '@madmedsales/shared';
import { apiFetch } from '../../lib/api';

interface EmailPreviewPanelProps {
  campaignId: string;
  email: CampaignEmail;
  onClose: () => void;
  onUpdate: () => void;
}

function formatDt(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function EmailPreviewPanel({ campaignId, email, onClose, onUpdate }: EmailPreviewPanelProps): ReactNode {
  const [subject, setSubject] = useState(email.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(email.body_html ?? '');
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showHtmlEdit, setShowHtmlEdit] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const isApproved = email.status === 'approved';
  const isRejected = email.status === 'rejected';
  const isSent     = email.status === 'sent';

  async function handleSave(): Promise<void> {
    setLoading(true);
    try {
      await apiFetch(`/api/campaigns/${campaignId}/emails/${email.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ subject, body_html: bodyHtml }),
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (err) { alert(`저장 실패: ${String(err)}`); }
    finally { setLoading(false); }
  }

  async function handleApprove(): Promise<void> {
    setLoading(true);
    try {
      if (subject !== email.subject || bodyHtml !== email.body_html) {
        await apiFetch(`/api/campaigns/${campaignId}/emails/${email.id}`, {
          method: 'PATCH', body: JSON.stringify({ subject, body_html: bodyHtml }),
        });
      }
      await apiFetch(`/api/campaigns/${campaignId}/emails/${email.id}/approve`, { method: 'POST' });
      onUpdate();
    } catch (err) { alert(`승인 실패: ${String(err)}`); }
    finally { setLoading(false); }
  }

  async function handleReject(): Promise<void> {
    if (!rejectNote.trim()) { alert('반려 사유를 입력하세요.'); return; }
    setLoading(true);
    try {
      await apiFetch(`/api/campaigns/${campaignId}/emails/${email.id}/reject`, {
        method: 'POST', body: JSON.stringify({ admin_note: rejectNote }),
      });
      onUpdate();
    } catch (err) { alert(`반려 실패: ${String(err)}`); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex h-full flex-col text-sm">
      {/* 헤더 */}
      <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900">{email.hospital_name}</div>
          {email.director_name && (
            <div className="text-xs font-medium text-blue-700 mt-0.5">
              {email.director_name} 원장님 앞
            </div>
          )}
          <div className="mt-0.5 text-xs text-gray-500">
            {[email.hospital_sido, email.hospital_sigungu].filter(Boolean).join(' ')} · {email.to_email}
          </div>
        </div>
        <button onClick={onClose} className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600">✕</button>
      </div>

      {/* 상태 배지 */}
      {(isApproved || isRejected || isSent) && (
        <div className={`px-4 py-2 text-xs font-medium ${
          isApproved ? 'bg-blue-50 text-blue-700' :
          isRejected ? 'bg-red-50 text-red-700' :
          'bg-green-50 text-green-700'
        }`}>
          {isApproved && `✓ 승인됨 ${email.reviewed_by ? `· ${email.reviewed_by}` : ''} ${formatDt(email.reviewed_at)}`}
          {isRejected && `✕ 반려됨 — ${email.admin_note ?? ''}`}
          {isSent && `✓ 발송됨 ${formatDt(email.sent_at)}`}
        </div>
      )}

      {/* 발송 후 이벤트 추적 (sent 이후) */}
      {isSent && (email.opened_at || email.clicked_at || email.bounced_at || email.delivered_at) && (
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">발송 추적</p>
          <div className="space-y-1">
            {email.delivered_at && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                도달 {formatDt(email.delivered_at)}
              </div>
            )}
            {email.opened_at && (
              <div className="flex items-center gap-2 text-xs text-green-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                열람 {formatDt(email.opened_at)}
              </div>
            )}
            {email.clicked_at && (
              <div className="flex items-center gap-2 text-xs text-purple-700">
                <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                클릭 {formatDt(email.clicked_at)}
              </div>
            )}
            {email.bounced_at && (
              <div className="flex items-center gap-2 text-xs text-red-600">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                반송 {formatDt(email.bounced_at)}
                {email.bounce_reason && <span className="text-red-400">— {email.bounce_reason}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {isSent && !email.opened_at && !email.clicked_at && !email.bounced_at && (
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-400">
          발송됨 — 아직 열람 반응 없음
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 제목 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">제목</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} disabled={isSent}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50" />
        </div>

        {/* 본문 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">본문</label>
            {!isSent && (
              <button onClick={() => setShowHtmlEdit(v => !v)} className="text-xs text-blue-500 hover:underline">
                {showHtmlEdit ? '미리보기' : 'HTML 편집'}
              </button>
            )}
          </div>
          {showHtmlEdit ? (
            <textarea value={bodyHtml} onChange={e => setBodyHtml(e.target.value)} rows={10}
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          ) : (
            <iframe srcDoc={bodyHtml || '<p style="color:#aaa;font-family:sans-serif;padding:16px">본문 없음</p>'}
              sandbox="allow-same-origin"
              className="h-80 w-full rounded border border-gray-200 bg-white"
              title="이메일 미리보기" />
          )}
        </div>

        {/* AI 프롬프트 (접기/펼치기) */}
        {email.ai_prompt_used && (
          <div>
            <button onClick={() => setShowPrompt(v => !v)}
              className="flex w-full items-center justify-between rounded border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
              <span>AI 생성 프롬프트 확인</span>
              <span>{showPrompt ? '▲' : '▼'}</span>
            </button>
            {showPrompt && (
              <pre className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-600 whitespace-pre-wrap">
                {email.ai_prompt_used}
              </pre>
            )}
          </div>
        )}

        {/* 반려 사유 */}
        {showRejectInput && (
          <div>
            <label className="mb-1 block text-xs font-medium text-red-600">반려 사유 *</label>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
              placeholder="반려 사유를 입력하세요"
              className="w-full rounded border border-red-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500" />
          </div>
        )}
      </div>

      {/* 액션 버튼 */}
      {!isSent && (
        <div className="border-t border-gray-200 p-4">
          {showRejectInput ? (
            <div className="flex gap-2">
              <button onClick={() => { setShowRejectInput(false); setRejectNote(''); }} disabled={loading}
                className="flex-1 rounded border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50">
                취소
              </button>
              <button onClick={handleReject} disabled={loading}
                className="flex-1 rounded bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
                반려 확정
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {(subject !== email.subject || bodyHtml !== email.body_html) && (
                <button onClick={handleSave} disabled={loading}
                  className="w-full rounded border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {saved ? '✓ 저장됨' : '저장'}
                </button>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowRejectInput(true)} disabled={loading}
                  className="flex-1 rounded border border-red-300 py-2 text-sm text-red-600 hover:bg-red-50">
                  반려
                </button>
                <button onClick={handleApprove} disabled={loading || isApproved}
                  className="flex-1 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isApproved ? '✓ 승인됨' : '승인'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
