import type { ReactNode } from 'react';
import { useDashboardKpis } from '../../hooks/use-dashboard';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  color: string;
}

function KpiCard({ title, value, subtitle, color }: KpiCardProps): ReactNode {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
    </div>
  );
}

export function KpiCards(): ReactNode {
  const { data, loading, error } = useDashboardKpis();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-gray-200" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="전체 리드" value="-" subtitle="데이터 로드 실패" color="text-gray-900" />
        <KpiCard title="오늘 발송" value="-" subtitle="데이터 로드 실패" color="text-blue-600" />
        <KpiCard title="오픈율" value="-" subtitle="데이터 로드 실패" color="text-green-600" />
        <KpiCard title="데모 예정" value="-" subtitle="데이터 로드 실패" color="text-orange-600" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="전체 리드"
        value={data.totalLeads.toLocaleString()}
        subtitle="활성 영업 리드"
        color="text-gray-900"
      />
      <KpiCard
        title="오늘 발송"
        value={data.todaySends}
        subtitle="오늘 발송된 이메일"
        color="text-blue-600"
      />
      <KpiCard
        title="오픈율"
        value={`${data.openRate}%`}
        subtitle="전체 이메일 오픈율"
        color="text-green-600"
      />
      <KpiCard
        title="데모 예정"
        value={data.demosScheduled}
        subtitle="예정된 데모"
        color="text-orange-600"
      />
    </div>
  );
}
