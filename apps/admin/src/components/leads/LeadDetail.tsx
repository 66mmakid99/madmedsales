import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeadDetail } from '../../hooks/use-leads';
import { LeadTimeline } from './LeadTimeline';

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

export function LeadDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useLeadDetail(id);

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

      <div className="mb-6 flex items-center gap-3">
        <span className={`rounded px-2 py-1 text-sm font-bold ${GRADE_COLORS[lead.grade ?? ''] ?? 'bg-gray-200'}`}>
          {lead.grade ?? '-'}
        </span>
        <h2 className="text-xl font-bold text-gray-900">
          {String(hospitalData?.name ?? '알 수 없는 병원')}
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
                          <div
                            className="h-3 rounded bg-blue-400"
                            style={{ width: `${val}%` }}
                          />
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
                  <p className="mt-1 text-sm text-gray-700">
                    {String(scoringData.ai_analysis)}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">타임라인</h3>
            {id && <LeadTimeline leadId={id} />}
          </div>
        </div>
      </div>
    </div>
  );
}
