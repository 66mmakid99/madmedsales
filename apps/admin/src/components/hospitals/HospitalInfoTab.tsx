import type { ReactNode } from 'react';
import { useState } from 'react';
import type { HospitalProfile, ScoreBreakdown, AxisBreakdown } from '../../hooks/use-hospitals';
import type { Hospital } from '@madmedsales/shared';

interface Props {
  hospital: Hospital;
  profile: HospitalProfile | null;
  scoreBreakdown?: ScoreBreakdown | null;
}

const GRADE_COLORS: Record<string, string> = {
  PRIME: 'bg-purple-50 text-purple-700 border-purple-200',
  HIGH: 'bg-blue-50 text-blue-700 border-blue-200',
  MID: 'bg-green-50 text-green-700 border-green-200',
  LOW: 'bg-gray-50 text-gray-500 border-gray-200',
};

/** 한국 전화번호 포맷팅 (표시용만, DB 원본 불변) */
function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '-';
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 8) return raw;

  // 02 (서울): 02-XXXX-XXXX 또는 02-XXX-XXXX
  if (digits.startsWith('02')) {
    if (digits.length === 10) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
    if (digits.length === 9) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return raw;
  }

  // 010, 011 등 휴대폰: 010-XXXX-XXXX
  if (digits.startsWith('01') && digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  // 031~064 지역번호: 0XX-XXXX-XXXX 또는 0XX-XXX-XXXX
  if (digits.startsWith('0') && digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // 이미 포맷된 경우 그대로 반환
  return raw;
}

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }): ReactNode {
  const pct = Math.min((score / max) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="h-2 flex-1 rounded bg-gray-200">
        <div className="h-2 rounded bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-medium">{score}</span>
    </div>
  );
}

export function HospitalInfoTab({ hospital, profile, scoreBreakdown }: Props): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* 기본 정보 */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">기본 정보</h3>
        <dl className="space-y-2 text-sm">
          <InfoRow label="원장" value={hospital.doctor_name} />
          <InfoRow label="진료과" value={hospital.department} />
          <InfoRow label="전화" value={formatPhone(hospital.phone)} />
          <InfoRow label="이메일" value={hospital.email} />
          <div className="flex justify-between">
            <dt className="text-slate-500">주소</dt>
            <dd className="text-right font-medium">{hospital.address ?? '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">지역</dt>
            <dd className="font-medium">
              {hospital.sido ?? '-'} {hospital.sigungu ?? ''} {hospital.dong ?? ''}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">웹사이트</dt>
            <dd className="font-medium">
              {hospital.website ? (
                <a href={hospital.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {hospital.website}
                </a>
              ) : '-'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">데이터 품질</dt>
            <dd className="flex items-center gap-2">
              <div className="h-2 w-20 rounded bg-gray-200">
                <div className="h-2 rounded bg-blue-500" style={{ width: `${hospital.data_quality_score}%` }} />
              </div>
              <span className="text-xs font-medium">{hospital.data_quality_score}</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* 프로파일 스코어 + 점수 근거 */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">프로파일 분석</h3>
            {profile?.profile_grade ? (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${GRADE_COLORS[profile.profile_grade] ?? GRADE_COLORS.LOW}`}>
                {profile.profile_grade}
              </span>
            ) : null}
          </div>

          {!profile ? (
            <p className="text-sm text-slate-400">프로파일 분석 데이터 없음</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <ScoreBar label="투자성향" score={scoreBreakdown?.[0]?.totalScore ?? profile.investment_score} />
                <ScoreBar label="포트폴리오" score={scoreBreakdown?.[1]?.totalScore ?? profile.portfolio_diversity_score} />
                <ScoreBar label="규모·신뢰" score={scoreBreakdown?.[2]?.totalScore ?? profile.practice_scale_score} />
                <ScoreBar label="마케팅" score={scoreBreakdown?.[3]?.totalScore ?? Number(profile.marketing_activity_score)} />
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">종합 점수 (가중합산)</span>
                  <span className="text-lg font-bold text-indigo-600">
                    {scoreBreakdown
                      ? scoreBreakdown.reduce((sum, axis) => sum + axis.weightedScore, 0)
                      : profile.profile_score}
                  </span>
                </div>
              </div>

              {profile.ai_summary ? (
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-slate-500">AI 분석 요약</p>
                  <p className="mt-1 text-sm text-slate-800">{profile.ai_summary}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 text-xs">
                {profile.main_focus ? (
                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">{profile.main_focus}</span>
                ) : null}
                {profile.target_audience ? (
                  <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">{profile.target_audience}</span>
                ) : null}
              </div>

              {profile.analyzed_at ? (
                <p className="text-xs text-slate-400">
                  분석일: {new Date(profile.analyzed_at).toLocaleDateString('ko-KR')}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* 점수 산출 근거 아코디언 */}
        {profile && scoreBreakdown ? (
          <ScoreBreakdownAccordion profile={profile} breakdown={scoreBreakdown} />
        ) : null}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }): ReactNode {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value ?? '-'}</dd>
    </div>
  );
}

/* ── 점수 산출 근거 아코디언 ── */

function ScoreBreakdownAccordion({ breakdown }: { profile: HospitalProfile; breakdown: ScoreBreakdown }): ReactNode {
  const totalWeighted = breakdown.reduce((sum, axis) => sum + axis.weightedScore, 0);

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-800">점수 산출 근거</h3>
        <span className="text-xs text-slate-400">가중합산 {totalWeighted}점</span>
      </div>
      <div className="divide-y">
        {breakdown.map((axis) => (
          <AxisAccordionItem key={axis.axisLabel} axis={axis} />
        ))}
      </div>
    </div>
  );
}

function AxisAccordionItem({ axis }: { axis: AxisBreakdown }): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800">{axis.axisLabel}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            가중치 {axis.weight}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">→ +{axis.weightedScore}점</span>
          <span className="text-sm font-bold text-indigo-600">{axis.totalScore}점</span>
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {open && (
        <div className="border-t bg-gray-50 px-5 py-3">
          <div className="space-y-2.5">
            {axis.items.map((item, i) => {
              const pct = item.maxPoints > 0 ? Math.min((item.points / item.maxPoints) * 100, 100) : 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-800">{item.label}</span>
                    <span className="text-xs font-bold text-indigo-600">
                      {item.points}/{item.maxPoints}점
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-indigo-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">{item.value}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
