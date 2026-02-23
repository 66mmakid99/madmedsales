import type { ReactNode } from 'react';
import { useDashboardStats, useMatchDetails } from '../hooks/use-dashboard';
import { DataKpiCards } from '../components/dashboard/DataKpiCards';
import { PipelineFunnel } from '../components/dashboard/PipelineFunnel';
import { RecentActivityFeed } from '../components/dashboard/RecentActivityFeed';
import { MonthlyCostCard } from '../components/dashboard/MonthlyCostCard';
import { GradeDistributionChart } from '../components/dashboard/GradeDistributionChart';
import { MatchDetailTable } from '../components/dashboard/MatchDetailTable';

export function Dashboard(): ReactNode {
  const { data, loading, error } = useDashboardStats();
  const { data: matchData, loading: matchLoading } = useMatchDetails();

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">대시보드</h2>
          <p className="mt-1 text-sm text-slate-500">데이터 수집 · 분석 · 영업 현황</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-72 animate-pulse rounded-lg bg-gray-200" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-bold text-slate-800">대시보드</h2>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">{error ?? '데이터를 불러올 수 없습니다'}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-xs font-medium text-red-700 underline"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h2 className="text-lg font-bold text-slate-800">대시보드</h2>
        <p className="mt-1 text-sm text-slate-500">데이터 수집 · 분석 · 영업 현황</p>
      </div>

      {/* Row 1: KPI 카드 4개 */}
      <DataKpiCards kpi={data.kpi} />

      {/* Row 2: 영업 퍼널 + 최근 활동 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PipelineFunnel pipeline={data.pipeline} />
        <RecentActivityFeed activities={data.recentActivity} />
      </div>

      {/* Row 3: 비용 + 등급 분포 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MonthlyCostCard cost={data.monthlyCost} />
        <GradeDistributionChart grades={data.profileGradeDistribution} />
      </div>

      {/* Row 4: 매칭 상세 */}
      {matchLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-gray-200" />
      ) : (
        <MatchDetailTable matches={matchData ?? []} />
      )}
    </div>
  );
}
