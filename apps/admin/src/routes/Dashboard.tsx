import type { ReactNode } from 'react';
import { KpiCards } from '../components/dashboard/KpiCards';
import { PipelineSummary } from '../components/dashboard/PipelineSummary';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import { EmailStatsCard } from '../components/dashboard/EmailStats';

export function Dashboard(): ReactNode {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-900">대시보드</h2>
      <KpiCards />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PipelineSummary />
        <EmailStatsCard />
      </div>
      <RecentActivity />
    </div>
  );
}
