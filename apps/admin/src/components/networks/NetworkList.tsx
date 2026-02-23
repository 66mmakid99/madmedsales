import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useNetworks, useNetworkSummary } from '../../hooks/use-networks';
import type { NetworkWithStats } from '@madmedsales/shared';

const CATEGORY_LABELS: Record<string, string> = {
  franchise: '프랜차이즈',
  network: '네트워크',
  group: '그룹',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-600',
  unverified: 'bg-yellow-100 text-yellow-700',
};

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }): ReactNode {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function NetworkRow({ network }: { network: NetworkWithStats }): ReactNode {
  const total = network.confirmed_count + network.probable_count + network.candidate_count;

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        <Link to={`/networks/${network.id}`} className="font-medium text-blue-600 hover:text-blue-800">
          {network.name}
        </Link>
        {network.official_name && (
          <p className="text-xs text-gray-400 mt-0.5">{network.official_name}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[network.status] ?? ''}`}>
          {network.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">
        {CATEGORY_LABELS[network.category] ?? network.category}
      </td>
      <td className="px-4 py-3 text-sm font-medium">{total}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          {network.confirmed_count > 0 && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
              확인 {network.confirmed_count}
            </span>
          )}
          {network.probable_count > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
              유력 {network.probable_count}
            </span>
          )}
          {network.candidate_count > 0 && (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700">
              후보 {network.candidate_count}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">
        {network.official_site_url ? (
          <a href={network.official_site_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            공식사이트
          </a>
        ) : '-'}
      </td>
    </tr>
  );
}

export function NetworkList(): ReactNode {
  const { data: networks, loading, error } = useNetworks();
  const { data: summary } = useNetworkSummary();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-400">로딩 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">네트워크/체인 관리</h1>
      </div>

      {/* 요약 카드 */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="전체 네트워크" value={summary.totalNetworks} />
          <SummaryCard label="확인된 지점" value={summary.confirmedBranches} accent="text-green-600" />
          <SummaryCard label="검토 대기" value={summary.probableBranches + summary.candidateBranches} accent="text-yellow-600" />
          <SummaryCard label="전체 매칭 지점" value={summary.totalBranches} accent="text-blue-600" />
        </div>
      )}

      {/* 네트워크 목록 */}
      <div className="rounded-lg bg-white shadow-sm border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">브랜드명</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">상태</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">유형</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">지점</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">검증 현황</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">사이트</th>
              </tr>
            </thead>
            <tbody>
              {(networks ?? []).map(n => <NetworkRow key={n.id} network={n} />)}
            </tbody>
          </table>
        </div>

        {(!networks || networks.length === 0) && (
          <div className="py-12 text-center text-gray-400">
            등록된 네트워크가 없습니다. 시드 스크립트를 실행하세요.
          </div>
        )}
      </div>
    </div>
  );
}
