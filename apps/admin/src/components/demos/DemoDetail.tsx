import type { ReactNode } from 'react';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDemoDetail } from '../../hooks/use-demos';
import { apiFetch } from '../../lib/api';

const STATUS_LABELS: Record<string, string> = {
  requested: '요청됨',
  confirmed: '확정',
  preparing: '준비중',
  in_progress: '진행중',
  completed: '완료',
  evaluated: '평가완료',
  cancelled: '취소',
};

const TYPE_LABELS: Record<string, string> = {
  online: '온라인',
  visit: '방문',
  self_video: '셀프영상',
};

const INTENT_LABELS: Record<string, string> = {
  immediate: '즉시 구매',
  considering: '검토중',
  hold: '보류',
  no_interest: '관심 없음',
};

const INTENT_OPTIONS = [
  { value: 'immediate', label: '즉시 구매' },
  { value: 'considering', label: '검토중' },
  { value: 'hold', label: '보류' },
  { value: 'no_interest', label: '관심 없음' },
];

function DemoActions({ demoId, status, onRefetch }: { demoId: string; status: string; onRefetch: () => void }): ReactNode {
  const [loading, setLoading] = useState('');

  async function handleAction(action: string, body?: Record<string, unknown>): Promise<void> {
    setLoading(action);
    try {
      await apiFetch(`/api/demos/${demoId}/${action}`, {
        method: 'PUT',
        body: JSON.stringify(body ?? {}),
      });
      onRefetch();
    } catch {
      // error handled by UI
    } finally {
      setLoading('');
    }
  }

  return (
    <div className="flex gap-2">
      {status === 'requested' && (
        <button
          onClick={() => handleAction('confirm', { scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString() })}
          disabled={loading === 'confirm'}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          확정
        </button>
      )}
      {(status === 'confirmed' || status === 'requested') && (
        <button
          onClick={() => handleAction('prepare')}
          disabled={loading === 'prepare'}
          className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          AI 준비
        </button>
      )}
      {(status === 'confirmed' || status === 'preparing') && (
        <button
          onClick={() => handleAction('complete')}
          disabled={loading === 'complete'}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          완료 처리
        </button>
      )}
      {status !== 'cancelled' && status !== 'completed' && status !== 'evaluated' && (
        <button
          onClick={() => handleAction('cancel')}
          disabled={loading === 'cancel'}
          className="rounded bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
        >
          취소
        </button>
      )}
    </div>
  );
}

function EvaluationForm({ demoId, onSubmitted }: { demoId: string; onSubmitted: () => void }): ReactNode {
  const [satisfaction, setSatisfaction] = useState(3);
  const [intent, setIntent] = useState('considering');
  const [payment, setPayment] = useState('');
  const [feedback, setFeedback] = useState('');
  const [questions, setQuestions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError('');
    try {
      await apiFetch(`/api/demos/${demoId}/evaluate`, {
        method: 'POST',
        body: JSON.stringify({
          satisfaction_score: satisfaction,
          purchase_intent: intent,
          preferred_payment: payment || undefined,
          feedback: feedback || undefined,
          additional_questions: questions || undefined,
        }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : '제출 실패');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">데모 평가 제출</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">만족도</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setSatisfaction(n)}
                className={`text-2xl ${n <= satisfaction ? 'text-yellow-400' : 'text-gray-300'}`}
              >
                ★
              </button>
            ))}
            <span className="ml-2 self-center text-sm text-gray-500">{satisfaction}/5</span>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">구매 의향</label>
          <div className="flex flex-wrap gap-2">
            {INTENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setIntent(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  intent === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">결제 선호</label>
          <div className="flex flex-wrap gap-2">
            {(['일시불', '리스', '할부', '미정'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setPayment(payment === opt ? '' : opt)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  payment === opt
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">피드백</label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="고객 피드백"
            className="w-full rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">추가 질문</label>
          <textarea
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            rows={2}
            placeholder="고객이 남긴 추가 질문"
            className="w-full rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '제출 중...' : '평가 제출'}
        </button>
      </div>
    </div>
  );
}

export function DemoDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useDemoDetail(id);

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-gray-200" />
      <div className="h-64 rounded bg-gray-200" />
    </div>;
  }

  if (error || !data) {
    return (
      <div className="text-center">
        <p className="text-red-500">{error ?? '데모를 찾을 수 없습니다.'}</p>
        <button onClick={() => navigate('/demos')} className="mt-4 text-sm text-blue-600">
          목록으로
        </button>
      </div>
    );
  }

  const { demo, evaluation } = data;

  return (
    <div>
      <button
        onClick={() => navigate('/demos')}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        &larr; 데모 목록
      </button>

      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">데모 상세</h2>
        <DemoActions demoId={demo.id} status={demo.status} onRefetch={refetch} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">데모 정보</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">유형</dt>
              <dd className="font-medium">{TYPE_LABELS[demo.demo_type] ?? demo.demo_type}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">상태</dt>
              <dd className="font-medium">{STATUS_LABELS[demo.status] ?? demo.status}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">요청일</dt>
              <dd>{new Date(demo.requested_at).toLocaleString('ko-KR')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">예정일</dt>
              <dd>
                {demo.scheduled_at
                  ? new Date(demo.scheduled_at).toLocaleString('ko-KR')
                  : '미정'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">완료일</dt>
              <dd>
                {demo.completed_at
                  ? new Date(demo.completed_at).toLocaleString('ko-KR')
                  : '-'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">담당자</dt>
              <dd>{demo.assigned_to ?? '-'}</dd>
            </div>
          </dl>
          {demo.notes && (
            <div className="mt-4 rounded bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">메모</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{demo.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {demo.prep_summary && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">AI 준비 자료</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500">브리핑 요약</p>
                  <p className="text-sm text-gray-700">{demo.prep_summary}</p>
                </div>
                {demo.prep_product_pitch && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">제품 피치</p>
                    <p className="text-sm text-gray-700">{demo.prep_product_pitch}</p>
                  </div>
                )}
                {demo.prep_roi_simulation && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">ROI 시뮬레이션</p>
                    <pre className="mt-1 rounded bg-gray-50 p-2 text-xs text-gray-600">
                      {JSON.stringify(demo.prep_roi_simulation, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {evaluation && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">고객 평가</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">만족도</dt>
                  <dd className="font-medium">
                    {'★'.repeat(evaluation.satisfaction_score ?? 0)}
                    {'☆'.repeat(5 - (evaluation.satisfaction_score ?? 0))}
                    <span className="ml-1 text-gray-400">
                      ({evaluation.satisfaction_score}/5)
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">구매 의향</dt>
                  <dd className="font-medium">
                    {INTENT_LABELS[evaluation.purchase_intent ?? ''] ?? evaluation.purchase_intent ?? '-'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">결제 선호</dt>
                  <dd className="font-medium">{evaluation.preferred_payment ?? '-'}</dd>
                </div>
              </dl>
              {evaluation.feedback && (
                <div className="mt-3 rounded bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">피드백</p>
                  <p className="mt-1 text-sm text-gray-700">{evaluation.feedback}</p>
                </div>
              )}
              {evaluation.additional_questions && (
                <div className="mt-3 rounded bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">추가 질문</p>
                  <p className="mt-1 text-sm text-gray-700">{evaluation.additional_questions}</p>
                </div>
              )}
            </div>
          )}

          {!evaluation && (demo.status === 'completed' || demo.status === 'in_progress') && (
            <EvaluationForm demoId={demo.id} onSubmitted={refetch} />
          )}

          {!evaluation && demo.status !== 'completed' && demo.status !== 'in_progress' && demo.status !== 'evaluated' && (
            <div className="rounded-lg border border-dashed bg-gray-50 p-5 text-center">
              <p className="text-sm text-gray-400">데모 완료 후 평가를 진행할 수 있습니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
