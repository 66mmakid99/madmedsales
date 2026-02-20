import type { ReactNode } from 'react';
import { useEmailStats } from '../../hooks/use-dashboard';

export function EmailStatsPage(): ReactNode {
  const { data, loading, error } = useEmailStats();

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-gray-200" />
      <div className="h-64 rounded bg-gray-200" />
    </div>;
  }

  if (error || !data) {
    return <p className="text-red-500">{error ?? '데이터를 불러올 수 없습니다.'}</p>;
  }

  const metrics = [
    { label: '발송', count: data.sent, rate: 100, color: 'bg-blue-500' },
    { label: '도달', count: data.delivered, rate: data.deliveryRate, color: 'bg-blue-400' },
    { label: '오픈', count: data.opened, rate: data.openRate, color: 'bg-green-500' },
    { label: '클릭', count: data.clicked, rate: data.clickRate, color: 'bg-orange-500' },
    { label: '답장', count: data.replied, rate: data.replyRate, color: 'bg-purple-500' },
  ];

  const maxCount = Math.max(...metrics.map((m) => m.count), 1);

  return (
    <div>
      <h2 className="mb-6 text-lg font-bold text-gray-900">이메일 성과 분석</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border bg-white p-4 text-center shadow-sm">
            <p className="text-sm text-gray-500">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{m.count.toLocaleString()}</p>
            <p className="mt-1 text-sm font-medium text-gray-600">{m.rate}%</p>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">퍼널 차트</h3>
        <div className="space-y-3">
          {metrics.map((m) => {
            const width = maxCount > 0 ? (m.count / maxCount) * 100 : 0;
            return (
              <div key={m.label} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-sm text-gray-600">{m.label}</span>
                <div className="flex-1">
                  <div className="h-8 rounded bg-gray-100">
                    <div
                      className={`flex h-8 items-center rounded px-3 text-sm font-medium text-white ${m.color}`}
                      style={{ width: `${Math.max(width, m.count > 0 ? 5 : 0)}%` }}
                    >
                      {m.count > 0 ? m.count.toLocaleString() : ''}
                    </div>
                  </div>
                </div>
                <span className="w-12 text-right text-sm font-medium text-gray-500">
                  {m.rate}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
