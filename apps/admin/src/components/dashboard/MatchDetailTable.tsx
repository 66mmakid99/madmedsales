import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MatchDetailItem } from '../../hooks/use-dashboard';

interface Props {
  matches: MatchDetailItem[];
}

const MATCH_GRADE_STYLE: Record<string, string> = {
  S: 'bg-purple-50 text-purple-700 border-purple-200',
  A: 'bg-blue-50 text-blue-700 border-blue-200',
  B: 'bg-green-50 text-green-700 border-green-200',
  C: 'bg-amber-50 text-amber-700 border-amber-200',
  EXCLUDE: 'bg-red-50 text-red-500 border-red-200',
};

const PROFILE_GRADE_STYLE: Record<string, string> = {
  PRIME: 'bg-violet-600 text-white',
  HIGH: 'bg-blue-600 text-white',
  MID: 'bg-amber-500 text-white',
  LOW: 'bg-gray-400 text-white',
};

const ANGLE_LABELS: Record<string, string> = {
  bridge_care: '브릿지',
  post_op_care: '수술후',
  mens_target: '남성',
  painless_focus: '무통',
  combo_body: '바디',
};

function scoreBarColor(score: number): string {
  if (score >= 60) return 'bg-violet-500';
  if (score >= 40) return 'bg-blue-500';
  if (score >= 20) return 'bg-emerald-500';
  return 'bg-gray-300';
}

export function MatchDetailTable({ matches }: Props): ReactNode {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // v3.1 매칭만 필터 (angleBreakdown이 있는 것)
  const v31Matches = matches.filter(m => m.angleBreakdown.length > 0);
  const legacyMatches = matches.filter(m => m.angleBreakdown.length === 0);

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-400">매칭 데이터가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* v3.1 매칭 상세 테이블 */}
      <div className="rounded-lg border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">영업 매칭 상세</h3>
            <p className="mt-0.5 text-xs text-slate-400">제품별 영업각도 점수 Breakdown + 피치 포인트</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-slate-500">
            {v31Matches.length}건
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">병원</th>
                <th className="px-3 py-2.5 font-medium text-center">프로파일</th>
                <th className="px-3 py-2.5 font-medium text-center">매칭</th>
                <th className="px-3 py-2.5 font-medium text-center">점수</th>
                {/* 영업각도 컬럼 */}
                <th className="px-2 py-2.5 text-center font-medium" title="브릿지 케어 (45%)">
                  <div className="text-[10px] leading-tight">브릿지<br /><span className="text-slate-400">45%</span></div>
                </th>
                <th className="px-2 py-2.5 text-center font-medium" title="수술 후 회복 (25%)">
                  <div className="text-[10px] leading-tight">수술후<br /><span className="text-slate-400">25%</span></div>
                </th>
                <th className="px-2 py-2.5 text-center font-medium" title="남성 타겟 (15%)">
                  <div className="text-[10px] leading-tight">남성<br /><span className="text-slate-400">15%</span></div>
                </th>
                <th className="px-2 py-2.5 text-center font-medium" title="무통·편의 (10%)">
                  <div className="text-[10px] leading-tight">무통<br /><span className="text-slate-400">10%</span></div>
                </th>
                <th className="px-2 py-2.5 text-center font-medium" title="바디 콤보 (5%)">
                  <div className="text-[10px] leading-tight">바디<br /><span className="text-slate-400">5%</span></div>
                </th>
                <th className="px-3 py-2.5 font-medium">피치 포인트</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {v31Matches.map((m) => {
                const isExpanded = expandedId === m.hospitalId;
                return (
                  <tr
                    key={m.hospitalId + m.productName}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                    onClick={() => setExpandedId(isExpanded ? null : m.hospitalId)}
                  >
                    <td className="px-4 py-2.5">
                      <button
                        className="text-left font-medium text-slate-800 hover:text-indigo-600"
                        onClick={(e) => { e.stopPropagation(); navigate(`/hospitals/${m.hospitalId}`); }}
                      >
                        {m.hospitalName}
                      </button>
                      <div className="text-[11px] text-slate-400">
                        {m.region ?? '-'} · {m.department ?? '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {m.profileGrade ? (
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${PROFILE_GRADE_STYLE[m.profileGrade] ?? 'bg-gray-200 text-gray-600'}`}>
                          {m.profileGrade}
                        </span>
                      ) : <span className="text-[10px] text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${MATCH_GRADE_STYLE[m.matchGrade] ?? MATCH_GRADE_STYLE.C}`}>
                        {m.matchGrade}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-sm font-semibold text-slate-800">
                      {m.totalScore}
                    </td>
                    {/* 영업각도 점수 바 */}
                    {['bridge_care', 'post_op_care', 'mens_target', 'painless_focus', 'combo_body'].map((angleId) => {
                      const angle = m.angleBreakdown.find(a => a.id === angleId);
                      const score = angle?.score ?? 0;
                      return (
                        <td key={angleId} className="px-2 py-2.5 text-center">
                          <div className="mx-auto w-10">
                            <div className="h-1.5 w-full rounded-full bg-gray-100">
                              <div
                                className={`h-1.5 rounded-full ${scoreBarColor(score)}`}
                                style={{ width: `${Math.min(score, 100)}%` }}
                              />
                            </div>
                            <span className="mt-0.5 block text-[10px] text-slate-400">{score}</span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {m.topPitchPoints.map((pp) => (
                          <span
                            key={pp}
                            className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600"
                          >
                            {ANGLE_LABELS[pp] ?? pp}
                          </span>
                        ))}
                        {m.topPitchPoints.length === 0 && (
                          <span className="text-[10px] text-gray-300">-</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legacy 매칭 (v1.0) */}
      {legacyMatches.length > 0 && (
        <div className="rounded-lg border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h3 className="text-xs font-semibold text-slate-500">Legacy 매칭 (v1.0)</h3>
            <span className="text-[10px] text-slate-400">{legacyMatches.length}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-gray-50 text-[10px] text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">병원</th>
                  <th className="px-3 py-2 font-medium">제품</th>
                  <th className="px-3 py-2 font-medium text-center">등급</th>
                  <th className="px-3 py-2 font-medium text-center">점수</th>
                  <th className="px-3 py-2 font-medium">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {legacyMatches.map((m) => (
                  <tr key={m.hospitalId + m.productName} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-slate-800">{m.hospitalName}</td>
                    <td className="px-3 py-2 text-slate-500">{m.productName}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${MATCH_GRADE_STYLE[m.matchGrade] ?? MATCH_GRADE_STYLE.C}`}>
                        {m.matchGrade}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-slate-500">{m.totalScore}</td>
                    <td className="px-3 py-2 text-slate-400">{m.scoringVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
