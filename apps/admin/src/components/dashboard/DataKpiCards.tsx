import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardStatsKpi } from '../../hooks/use-dashboard';

interface Props {
  kpi: DashboardStatsKpi;
}

interface CardConfig {
  label: string;
  value: string;
  sub: string;
  accent: string;
  bg: string;
  link?: string;
}

export function DataKpiCards({ kpi }: Props): ReactNode {
  const navigate = useNavigate();

  const cards: CardConfig[] = [
    {
      label: '프로파일링 완료',
      value: `${kpi.profiledCount.toLocaleString()}`,
      sub: `/ ${kpi.totalHospitals.toLocaleString()} 병원`,
      accent: 'text-indigo-600',
      bg: 'bg-indigo-50',
      link: '/hospitals?tab=profiled',
    },
    {
      label: '활성 리드',
      value: '0',
      sub: 'Phase 3에서 활성화',
      accent: 'text-slate-400',
      bg: 'bg-slate-50',
      link: '/leads',
    },
    {
      label: '이번주 크롤',
      value: kpi.weekCrawls.toLocaleString(),
      sub: `미분석 ${kpi.pendingCrawl.toLocaleString()}건`,
      accent: 'text-emerald-600',
      bg: 'bg-emerald-50',
      link: '/crawls',
    },
    {
      label: '데모 예정',
      value: '0',
      sub: 'Phase 6에서 활성화',
      accent: 'text-slate-400',
      bg: 'bg-slate-50',
      link: '/demos',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <button
          key={c.label}
          onClick={() => c.link && navigate(c.link)}
          className="group relative overflow-hidden rounded-lg border border-gray-100 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{c.label}</p>
          <p className={`mt-2 text-3xl font-bold tracking-tight ${c.accent}`}>{c.value}</p>
          <p className="mt-1 text-xs text-slate-500">{c.sub}</p>
        </button>
      ))}
    </div>
  );
}
