import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDemoDetail } from '../../hooks/use-demos';

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

export function DemoDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useDemoDetail(id);

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

      <h2 className="mb-6 text-xl font-bold text-gray-900">데모 상세</h2>

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
          {demo.prep_scoring_summary && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">AI 준비 자료</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-500">스코어링 요약</p>
                  <p className="text-sm text-gray-700">{demo.prep_scoring_summary}</p>
                </div>
                {demo.prep_combo_suggestion && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">콤보 제안</p>
                    <p className="text-sm text-gray-700">{demo.prep_combo_suggestion}</p>
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

          {!evaluation && demo.status === 'completed' && (
            <div className="rounded-lg border border-dashed bg-gray-50 p-5 text-center">
              <p className="text-sm text-gray-400">아직 평가가 제출되지 않았습니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
