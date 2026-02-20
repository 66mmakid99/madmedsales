import type { ReactNode } from 'react';
import { useEmailStats } from '../../hooks/use-dashboard';

interface StatRowProps {
  label: string;
  count: number;
  rate: number;
  color: string;
}

function StatRow({ label, count, rate, color }: StatRowProps): ReactNode {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-gray-900">{count.toLocaleString()}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>
          {rate}%
        </span>
      </div>
    </div>
  );
}

export function EmailStatsCard(): ReactNode {
  const { data, loading, error } = useEmailStats();

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">이메일 성과</h3>
      {loading && <div className="h-40 animate-pulse rounded bg-gray-200" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!loading && data && (
        <div className="divide-y">
          <StatRow label="발송" count={data.sent} rate={100} color="bg-gray-100 text-gray-700" />
          <StatRow label="도달" count={data.delivered} rate={data.deliveryRate} color="bg-blue-50 text-blue-700" />
          <StatRow label="오픈" count={data.opened} rate={data.openRate} color="bg-green-50 text-green-700" />
          <StatRow label="클릭" count={data.clicked} rate={data.clickRate} color="bg-orange-50 text-orange-700" />
          <StatRow label="답장" count={data.replied} rate={data.replyRate} color="bg-purple-50 text-purple-700" />
        </div>
      )}
    </div>
  );
}
