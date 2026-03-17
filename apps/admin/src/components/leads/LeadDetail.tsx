import type { ReactNode } from 'react';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeadDetail } from '../../hooks/use-leads';
import { LeadTimeline } from './LeadTimeline';
import { apiFetch } from '../../lib/api';

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-red-500 text-white',
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-500 text-white',
};

const SCORE_LABELS: Record<string, string> = {
  score_equipment_synergy: '장비 시너지',
  score_equipment_age: '장비 노후도',
  score_revenue_impact: '매출 영향',
  score_competitive_edge: '경쟁 우위',
  score_purchase_readiness: '구매 준비도',
};

const STAGE_LABELS: Record<string, string> = {
  new: '신규', contacted: '연락완료', responded: '응답',
  kakao_connected: '카카오', demo_scheduled: '데모예정',
  demo_done: '데모완료', proposal: '제안', negotiation: '협상',
  closed_won: '성사', closed_lost: '실패', nurturing: '육성',
};

const STAGES_FOR_CHANGE = [
  { value: 'new', label: '신규' },
  { value: 'contacted', label: '연락완료' },
  { value: 'responded', label: '응답' },
  { value: 'kakao_connected', label: '카카오' },
  { value: 'demo_scheduled', label: '데모예정' },
  { value: 'demo_done', label: '데모완료' },
  { value: 'proposal', label: '제안' },
  { value: 'negotiation', label: '협상' },
  { value: 'closed_won', label: '성사' },
  { value: 'closed_lost', label: '실패' },
  { value: 'nurturing', label: '육성' },
];

function LeadActions({ leadId, stage, refetch }: { leadId: string; stage: string; refetch: () => void }): ReactNode {
  const navigate = useNavigate();
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [showMemoForm, setShowMemoForm] = useState(false);
  const [demoType, setDemoType] = useState('visit');
  const [memoText, setMemoText] = useState('');
  const [loading, setLoading] = useState('');
  const [msg, setMsg] = useState('');

  async function handleScheduleDemo(): Promise<void> {
    setLoading('demo');
    setMsg('');
    try {
      const result = await apiFetch<{ id: string }>('/api/demos', {
        method: 'POST',
        body: JSON.stringify({
          lead_id: leadId,
          demo_type: demoType,
          scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        }),
      });
      setMsg('데모 예약 완료');
      setShowDemoForm(false);
      refetch();
      setTimeout(() => navigate(`/demos/${result.id}`), 1000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '실패');
    } finally {
      setLoading('');
    }
  }

  async function handleSendEmail(): Promise<void> {
    setLoading('email');
    setMsg('');
    try {
      await apiFetch('/api/emails/generate', {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId }),
      });
      setMsg('이메일 생성 완료');
      refetch();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '실패');
    } finally {
      setLoading('');
    }
  }

  async function handleSendKakao(): Promise<void> {
    setLoading('kakao');
    setMsg('');
    try {
      await apiFetch('/api/kakao/send', {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId }),
      });
      setMsg('카카오 전송 완료');
      refetch();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '실패');
    } finally {
      setLoading('');
    }
  }

  async function handleAddMemo(): Promise<void> {
    if (!memoText.trim()) return;
    setLoading('memo');
    setMsg('');
    try {
      await apiFetch(`/api/leads/${leadId}/activities`, {
        method: 'POST',
        body: JSON.stringify({ type: 'note', content: memoText.trim() }),
      });
      setMsg('메모 추가 완료');
      setMemoText('');
      setShowMemoForm(false);
      refetch();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '실패');
    } finally {
      setLoading('');
    }
  }

  async function handleStageChange(newStage: string): Promise<void> {
    if (newStage === stage) return;
    setLoading('stage');
    setMsg('');
    try {
      await apiFetch(`/api/leads/${leadId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: newStage }),
      });
      setMsg('단계 변경 완료');
      refetch();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '실패');
    } finally {
      setLoading('');
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">액션</h3>

      {/* 단계 변경 */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-gray-500">단계 변경</label>
        <select
          value={stage}
          onChange={(e) => handleStageChange(e.target.value)}
          disabled={loading === 'stage'}
          className="w-full rounded border px-2 py-1.5 text-sm disabled:opacity-50"
        >
          {STAGES_FOR_CHANGE.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setShowDemoForm(!showDemoForm)}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          데모 예약
        </button>
        <button
          onClick={() => navigate(`/leads?stage=${stage}`)}
          className="rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
        >
          같은 단계 리드
        </button>
      </div>

      {/* 이메일/카카오/메모 액션 */}
      <div className="mt-3 border-t pt-3">
        <p className="mb-2 text-xs text-gray-400">커뮤니케이션</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSendEmail}
            disabled={loading === 'email'}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading === 'email' ? '생성 중...' : '이메일 발송'}
          </button>
          <button
            onClick={handleSendKakao}
            disabled={loading === 'kakao'}
            className="rounded bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
          >
            {loading === 'kakao' ? '전송 중...' : '카카오 전송'}
          </button>
          <button
            onClick={() => { setShowMemoForm(!showMemoForm); setShowDemoForm(false); }}
            className="rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
          >
            메모 추가
          </button>
        </div>
      </div>

      {showMemoForm && (
        <div className="mt-3 space-y-2 rounded bg-gray-50 p-3">
          <textarea
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            rows={3}
            placeholder="메모 내용을 입력하세요..."
            className="w-full rounded border px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddMemo}
              disabled={loading === 'memo' || !memoText.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading === 'memo' ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => { setShowMemoForm(false); setMemoText(''); }}
              className="rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {showDemoForm && (
        <div className="mt-3 space-y-2 rounded bg-gray-50 p-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">데모 유형</label>
            <select
              value={demoType}
              onChange={(e) => setDemoType(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="visit">방문</option>
              <option value="online">온라인</option>
              <option value="self_video">셀프영상</option>
            </select>
          </div>
          <button
            onClick={handleScheduleDemo}
            disabled={loading === 'demo'}
            className="w-full rounded bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading === 'demo' ? '예약 중...' : '1주 후 데모 예약'}
          </button>
        </div>
      )}

      {msg && (
        <p className={`mt-2 text-xs ${msg.includes('완료') ? 'text-green-600' : 'text-red-500'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

export function LeadDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useLeadDetail(id);

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-gray-200" />
      <div className="h-64 rounded bg-gray-200" />
    </div>;
  }

  if (error || !data) {
    return (
      <div className="text-center">
        <p className="text-red-500">{error ?? '리드를 찾을 수 없습니다.'}</p>
        <button onClick={() => navigate('/leads')} className="mt-4 text-sm text-blue-600">
          목록으로
        </button>
      </div>
    );
  }

  const { lead, hospital, scoring, equipments, treatments } = data;
  const hospitalData = hospital as Record<string, unknown>;
  const scoringData = scoring as Record<string, number | string | null> | null;

  return (
    <div>
      <button
        onClick={() => navigate('/leads')}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        &larr; 리드 목록
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`rounded px-2 py-1 text-sm font-bold ${GRADE_COLORS[lead.grade ?? ''] ?? 'bg-gray-200'}`}>
            {lead.grade ?? '-'}
          </span>
          <h2 className="text-xl font-bold text-gray-900">
            {String(hospitalData?.name ?? '알 수 없는 병원')}
          </h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {STAGE_LABELS[lead.stage] ?? lead.stage}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 좌측: 병원 정보 + 장비 + 시술 */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">병원 정보</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">병원명</dt>
                <dd className="font-medium">{String(hospitalData?.name ?? '-')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">담당의</dt>
                <dd className="font-medium">{lead.contact_name ?? '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">이메일</dt>
                <dd className="font-medium">{lead.contact_email ?? '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">진료과</dt>
                <dd className="font-medium">{String(hospitalData?.department ?? '-')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">지역</dt>
                <dd className="font-medium">{String(hospitalData?.sido ?? '-')} {String(hospitalData?.sigungu ?? '')}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              보유 장비 ({equipments.length})
            </h3>
            {equipments.length === 0 ? (
              <p className="text-sm text-gray-400">장비 정보 없음</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {equipments.map((eq, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-gray-700">{String(eq.equipment_name ?? '-')}</span>
                    <span className="text-gray-400">{String(eq.equipment_category ?? '')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              시술 목록 ({treatments.length})
            </h3>
            {treatments.length === 0 ? (
              <p className="text-sm text-gray-400">시술 정보 없음</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {treatments.map((tr, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-gray-700">{String(tr.treatment_name ?? '-')}</span>
                    <span className="text-gray-400">
                      {tr.price_min ? `${Number(tr.price_min).toLocaleString()}원~` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 중앙: 스코어링 */}
        <div className="space-y-4">
          {scoringData && (
            <div className="rounded-lg border bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">스코어링</h3>
              <div className="mb-3 text-center">
                <span className="text-3xl font-bold text-blue-600">
                  {typeof scoringData.total_score === 'number' ? scoringData.total_score : '-'}
                </span>
                <span className="text-sm text-gray-400">/100</span>
              </div>
              <div className="space-y-2">
                {Object.entries(SCORE_LABELS).map(([key, label]) => {
                  const val = typeof scoringData[key] === 'number' ? (scoringData[key] as number) : 0;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-gray-500">{label}</span>
                      <div className="flex-1">
                        <div className="h-3 rounded bg-gray-100">
                          <div className="h-3 rounded bg-blue-400" style={{ width: `${val}%` }} />
                        </div>
                      </div>
                      <span className="w-8 text-right text-xs font-medium">{val}</span>
                    </div>
                  );
                })}
              </div>
              {scoringData.ai_analysis && (
                <div className="mt-4 rounded bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">AI 분석</p>
                  <p className="mt-1 text-sm text-gray-700">{String(scoringData.ai_analysis)}</p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">타임라인</h3>
            {id && <LeadTimeline leadId={id} />}
          </div>
        </div>

        {/* 우측: 액션 */}
        <div className="space-y-4">
          <LeadActions leadId={lead.id} stage={lead.stage} refetch={refetch} />
        </div>
      </div>
    </div>
  );
}
