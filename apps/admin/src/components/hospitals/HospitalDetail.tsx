import { useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHospitalDetail } from '../../hooks/use-hospitals';
import { HospitalInfoTab } from './HospitalInfoTab';
import { HospitalDataTab } from './HospitalDataTab';
import { HospitalAnalysisTab } from './HospitalAnalysisTab';

const TABS = ['기본 정보', '수집 데이터', '분석 결과'] as const;
type TabName = typeof TABS[number];

const GRADE_BADGE: Record<string, string> = {
  PRIME: 'bg-purple-50 text-purple-700 border-purple-200',
  HIGH: 'bg-blue-50 text-blue-700 border-blue-200',
  MID: 'bg-green-50 text-green-700 border-green-200',
  LOW: 'bg-gray-50 text-gray-500 border-gray-200',
};

export function HospitalDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useHospitalDetail(id);
  const [activeTab, setActiveTab] = useState<TabName>('기본 정보');
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-gray-200" />
        <div className="h-64 rounded bg-gray-200" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center">
        <p className="text-red-500">{error ?? '병원을 찾을 수 없습니다.'}</p>
        <button onClick={() => navigate('/hospitals')} className="mt-4 text-sm text-blue-600">
          목록으로
        </button>
      </div>
    );
  }

  const { equipments, treatments, profile, scoreBreakdown, matchScores, pricing, crawlHistory, dataSummary, ...hospital } = data;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/hospitals')}
          className="text-sm text-blue-600 hover:underline"
        >
          &larr; 병원 목록
        </button>
        <button
          onClick={() => showToast('리드 전환은 Phase 3에서 활성화됩니다')}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-gray-50"
        >
          → 리드로 전환
        </button>
      </div>

      <h2 className="mb-2 text-xl font-bold text-slate-800">{hospital.name}</h2>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* 데이터 수집 요약 바 */}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-gray-100 px-2 py-1 text-slate-500">
          장비 {dataSummary.equipmentCount}개
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-slate-500">
          시술 {dataSummary.treatmentCount}개
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-slate-500">
          가격 {dataSummary.pricingCount}건
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-slate-500">
          크롤 {dataSummary.crawlCount}회
        </span>
        {dataSummary.profileGrade ? (
          <span className={`rounded border px-2 py-1 font-semibold ${GRADE_BADGE[dataSummary.profileGrade] ?? 'bg-gray-50 text-gray-500'}`}>
            프로파일: {dataSummary.profileGrade}
          </span>
        ) : null}
        {dataSummary.lastCrawledAt ? (
          <span className="rounded bg-gray-50 px-2 py-1 text-slate-400">
            마지막 크롤: {new Date(dataSummary.lastCrawledAt).toLocaleDateString('ko-KR')}
          </span>
        ) : null}
      </div>

      {/* 탭 네비게이션 */}
      <div className="mb-6 border-b">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:border-gray-300 hover:text-slate-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === '기본 정보' ? (
        <HospitalInfoTab hospital={hospital} profile={profile} scoreBreakdown={scoreBreakdown} />
      ) : null}
      {activeTab === '수집 데이터' ? (
        <HospitalDataTab equipments={equipments} treatments={treatments} pricing={pricing} />
      ) : null}
      {activeTab === '분석 결과' ? (
        <HospitalAnalysisTab matchScores={matchScores} crawlHistory={crawlHistory} />
      ) : null}
    </div>
  );
}
