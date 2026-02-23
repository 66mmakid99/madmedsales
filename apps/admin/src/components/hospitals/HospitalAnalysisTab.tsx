import type { ReactNode } from 'react';
import type { ProductMatchScore, CrawlSnapshot } from '../../hooks/use-hospitals';

interface Props {
  matchScores: ProductMatchScore[];
  crawlHistory: CrawlSnapshot[];
}

const MATCH_GRADE_COLORS: Record<string, string> = {
  S: 'bg-purple-50 text-purple-700 border-purple-200',
  A: 'bg-blue-50 text-blue-700 border-blue-200',
  B: 'bg-green-50 text-green-700 border-green-200',
  C: 'bg-amber-50 text-amber-700 border-amber-200',
  EXCLUDE: 'bg-red-50 text-red-500 border-red-200',
};

const ANGLE_LABELS: Record<string, { label: string; weight: number }> = {
  bridge_care: { label: '시술 브릿지 케어', weight: 45 },
  post_op_care: { label: '수술 후 회복 관리', weight: 25 },
  mens_target: { label: '남성 타겟', weight: 15 },
  painless_focus: { label: '무통·편의 지향', weight: 10 },
  combo_body: { label: '바디 콤보', weight: 5 },
};

function scoreBarColor(score: number): string {
  if (score >= 60) return 'bg-violet-500';
  if (score >= 40) return 'bg-blue-500';
  if (score >= 20) return 'bg-emerald-500';
  if (score > 0) return 'bg-amber-400';
  return 'bg-gray-200';
}

function ScoreRing({ score, grade }: { score: number; grade: string | null }): ReactNode {
  const colorClass = grade ? (MATCH_GRADE_COLORS[grade]?.split(' ')[1] ?? 'text-slate-500') : 'text-slate-500';
  return (
    <div className="flex flex-col items-center">
      <span className={`text-2xl font-bold ${colorClass}`}>{score}</span>
      <span className="text-[10px] text-slate-400">/ 100</span>
    </div>
  );
}

export function HospitalAnalysisTab({ matchScores, crawlHistory }: Props): ReactNode {
  return (
    <div className="space-y-6">
      {/* 제품 매칭 결과 */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">
          제품 매칭 결과 ({matchScores.length})
        </h3>
        {matchScores.length === 0 ? (
          <p className="text-sm text-slate-400">매칭 결과 없음</p>
        ) : (
          <div className="space-y-4">
            {matchScores.map((ms) => {
              const angleScores = ms.sales_angle_scores;
              const hasAngles = angleScores && Object.keys(angleScores).length > 0;

              return (
                <div
                  key={ms.product_id}
                  className={`rounded-lg border p-4 ${MATCH_GRADE_COLORS[ms.grade ?? ''] ?? 'border-gray-200 bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{ms.product_name || '제품명 없음'}</p>
                      {ms.grade ? (
                        <span className="mt-1 inline-block rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold">
                          {ms.grade}등급
                        </span>
                      ) : null}
                    </div>
                    <ScoreRing score={ms.total_score} grade={ms.grade} />
                  </div>

                  {/* 영업각도별 점수 Breakdown */}
                  {hasAngles ? (
                    <div className="mt-3 border-t border-white/40 pt-3">
                      <p className="mb-2 text-[10px] font-medium uppercase text-slate-500">영업각도별 점수</p>
                      <div className="space-y-1.5">
                        {Object.entries(ANGLE_LABELS).map(([angleId, meta]) => {
                          const score = angleScores[angleId] ?? 0;
                          const weighted = Math.round(score * meta.weight / 100);
                          return (
                            <div key={angleId} className="flex items-center gap-2">
                              <span className="w-28 text-[11px] text-slate-500 truncate" title={meta.label}>
                                {meta.label}
                              </span>
                              <span className="w-8 text-right text-[10px] text-slate-400">{meta.weight}%</span>
                              <div className="h-2 flex-1 rounded-full bg-white/50">
                                <div
                                  className={`h-2 rounded-full transition-all ${scoreBarColor(score)}`}
                                  style={{ width: `${Math.min(score, 100)}%` }}
                                />
                              </div>
                              <span className="w-6 text-right text-xs font-medium text-slate-800">{score}</span>
                              <span className="w-8 text-right text-[10px] text-slate-400">+{weighted}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* 핵심 피치 포인트 */}
                  {ms.top_pitch_points && Array.isArray(ms.top_pitch_points) && ms.top_pitch_points.length > 0 ? (
                    <div className="mt-3 border-t border-white/40 pt-2">
                      <p className="mb-1 text-[10px] font-medium uppercase text-slate-500">핵심 피치 포인트</p>
                      <div className="flex flex-wrap gap-1">
                        {ms.top_pitch_points.slice(0, 5).map((pp, i) => {
                          const label = ANGLE_LABELS[pp]?.label ?? pp;
                          return (
                            <span key={i} className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {ms.scored_at ? (
                    <p className="mt-2 text-[10px] text-slate-400">
                      {new Date(ms.scored_at).toLocaleDateString('ko-KR')} 분석
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 추천 이메일 피치 */}
      <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">추천 이메일 피치</h3>
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-slate-500">프로파일링 데이터 기반으로 Phase 4에서 자동 생성 예정</p>
        </div>
      </div>

      {/* 크롤 히스토리 */}
      <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            크롤 히스토리 ({crawlHistory.length})
          </h3>
          <button
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-gray-50"
            onClick={() => {/* Phase 3 */}}
            title="Phase 3에서 활성화"
          >
            🔄 크롤 재실행
          </button>
        </div>
        {crawlHistory.length === 0 ? (
          <p className="text-sm text-slate-400">크롤 히스토리 없음</p>
        ) : (
          <div className="relative space-y-0">
            {crawlHistory.map((ch, i) => {
              const eqCount = Array.isArray(ch.equipments_found) ? ch.equipments_found.length : 0;
              const trCount = Array.isArray(ch.treatments_found) ? ch.treatments_found.length : 0;
              const prCount = Array.isArray(ch.pricing_found) ? ch.pricing_found.length : 0;
              const isLast = i === crawlHistory.length - 1;

              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500" />
                    {!isLast ? <div className="w-px flex-1 bg-gray-200" /> : null}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {new Date(ch.crawled_at).toLocaleString('ko-KR', {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                      {ch.tier ? (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-slate-500">{ch.tier}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-slate-500">
                      <span>장비 {eqCount}개</span>
                      <span>시술 {trCount}개</span>
                      <span>가격 {prCount}건</span>
                    </div>
                    {ch.diff_summary ? (
                      <p className="mt-1 text-xs text-indigo-600">{ch.diff_summary}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
