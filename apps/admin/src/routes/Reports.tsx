import type { ReactNode } from 'react';
import { useState } from 'react';
import { EmailStatsPage } from '../components/emails/EmailStats';
import { ProductPipelineSummary } from '../components/dashboard/ProductPipelineSummary';
import { useRevenueReport } from '../hooks/use-dashboard';

const TABS = [
  { id: 'overview', label: '전체 현황' },
  { id: 'email', label: '이메일 성과' },
] as const;

type TabId = typeof TABS[number]['id'];

function OverviewTab(): ReactNode {
  const { data, loading, error } = useRevenueReport();

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-gray-200" />;
  }

  if (error || !data) {
    return <p className="text-red-500">{error ?? '데이터를 불러올 수 없습니다.'}</p>;
  }

  const kpis = [
    { label: '총 리드', value: data.totalLeads, accent: 'text-gray-900' },
    { label: 'HOT 리드', value: data.hotLeads, accent: 'text-red-600' },
    { label: '성사', value: data.closedWon, accent: 'text-green-600' },
    { label: '총 데모', value: data.totalDemos, accent: 'text-blue-600' },
    { label: '총 이메일', value: data.totalEmails, accent: 'text-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-bold ${k.accent}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <ProductPipelineSummary />

      {data.closedWon > 0 && data.totalLeads > 0 && (
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">전환율</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-4 rounded-full bg-gray-100">
                <div
                  className="h-4 rounded-full bg-green-500"
                  style={{ width: `${Math.round((data.closedWon / data.totalLeads) * 100)}%` }}
                />
              </div>
            </div>
            <span className="text-lg font-bold text-green-600">
              {Math.round((data.closedWon / data.totalLeads) * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Reports(): ReactNode {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold text-gray-900">리포트</h2>

      <div className="mb-6 flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'email' && <EmailStatsPage />}
    </div>
  );
}
