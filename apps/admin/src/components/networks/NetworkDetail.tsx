import { useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useNetwork, useNetworkBranches, useVerifyBranch } from '../../hooks/use-networks';
import type { NetworkBranchWithHospital, ConfidenceLevel } from '@madmedsales/shared';

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { bg: string; text: string; label: string }> = {
  confirmed: { bg: 'bg-green-100', text: 'text-green-700', label: '확인됨' },
  probable: { bg: 'bg-blue-100', text: 'text-blue-700', label: '유력' },
  candidate: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '후보' },
  unlikely: { bg: 'bg-gray-100', text: 'text-gray-500', label: '미해당' },
};

type FilterTab = 'all' | ConfidenceLevel;

function ConfidenceBadge({ level }: { level: ConfidenceLevel }): ReactNode {
  const style = CONFIDENCE_STYLES[level];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function BranchRow({
  branch,
  onVerify,
  onRemove,
  verifying,
}: {
  branch: NetworkBranchWithHospital;
  onVerify: (id: string, confidence: ConfidenceLevel) => void;
  onRemove: (id: string) => void;
  verifying: boolean;
}): ReactNode {
  const hospital = branch.hospital;

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        <Link to={`/hospitals/${hospital.id}`} className="font-medium text-blue-600 hover:text-blue-800">
          {branch.branch_name ?? hospital.name}
        </Link>
        <p className="mt-0.5 text-xs text-gray-400">
          {hospital.sido} {hospital.sigungu}
          {hospital.phone ? ` | ${hospital.phone}` : ''}
        </p>
      </td>
      <td className="px-4 py-3">
        <ConfidenceBadge level={branch.confidence} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {branch.confidence_score}점
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 text-xs">
          {branch.official_site_verified && <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-600">공식</span>}
          {branch.domain_pattern_score > 0 && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600">도메인</span>}
          {branch.corporate_match_score > 0 && <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-600">법인</span>}
          {branch.keyword_match_score > 0 && <span className="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600">키워드</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">
        {branch.verified_at
          ? new Date(branch.verified_at).toLocaleDateString('ko-KR')
          : '-'}
      </td>
      <td className="px-4 py-3">
        {branch.confidence !== 'confirmed' && branch.confidence !== 'unlikely' && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onVerify(branch.id, 'confirmed')}
              disabled={verifying}
              className="rounded bg-green-500 px-2 py-1 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
            >
              확인
            </button>
            <button
              onClick={() => onRemove(branch.id)}
              disabled={verifying}
              className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-200 disabled:opacity-50"
            >
              제거
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function NetworkDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { data: network, loading: nLoading } = useNetwork(id);
  const { data: branches, loading: bLoading, refetch } = useNetworkBranches(id);
  const { verifying, verify, remove } = useVerifyBranch();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const handleVerify = async (branchId: string, confidence: ConfidenceLevel): Promise<void> => {
    const ok = await verify(branchId, confidence);
    if (ok) refetch();
  };

  const handleRemove = async (branchId: string): Promise<void> => {
    const ok = await remove(branchId, '수동 검토 후 제거');
    if (ok) refetch();
  };

  if (nLoading || bLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-400">로딩 중...</p>
      </div>
    );
  }

  if (!network) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-center">
        <p className="text-red-600">네트워크를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const allBranches = branches ?? [];
  const counts = {
    all: allBranches.filter(b => b.confidence !== 'unlikely').length,
    confirmed: allBranches.filter(b => b.confidence === 'confirmed').length,
    probable: allBranches.filter(b => b.confidence === 'probable').length,
    candidate: allBranches.filter(b => b.confidence === 'candidate').length,
    unlikely: allBranches.filter(b => b.confidence === 'unlikely').length,
  };

  const filtered = activeTab === 'all'
    ? allBranches.filter(b => b.confidence !== 'unlikely')
    : allBranches.filter(b => b.confidence === activeTab);

  const tabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'all', label: '전체', count: counts.all },
    { key: 'confirmed', label: '확인됨', count: counts.confirmed },
    { key: 'probable', label: '유력', count: counts.probable },
    { key: 'candidate', label: '후보', count: counts.candidate },
    { key: 'unlikely', label: '미해당', count: counts.unlikely },
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/networks" className="text-sm text-gray-400 hover:text-gray-600">&larr; 목록</Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{network.name}</h1>
          {network.official_name && (
            <p className="text-sm text-gray-500">{network.official_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {network.official_site_url && (
            <a
              href={network.official_site_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-blue-50 px-3 py-1.5 text-blue-600 hover:bg-blue-100"
            >
              공식사이트
            </a>
          )}
          <span className={`rounded px-3 py-1.5 text-xs font-medium ${
            network.status === 'active' ? 'bg-green-100 text-green-700' :
            network.status === 'unverified' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {network.status}
          </span>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg bg-green-50 p-3 text-center">
          <p className="text-xs text-green-600">확인됨</p>
          <p className="text-xl font-bold text-green-700">{counts.confirmed}</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-3 text-center">
          <p className="text-xs text-blue-600">유력</p>
          <p className="text-xl font-bold text-blue-700">{counts.probable}</p>
        </div>
        <div className="rounded-lg bg-yellow-50 p-3 text-center">
          <p className="text-xs text-yellow-600">후보</p>
          <p className="text-xl font-bold text-yellow-700">{counts.candidate}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <p className="text-xs text-gray-500">미해당</p>
          <p className="text-xl font-bold text-gray-600">{counts.unlikely}</p>
        </div>
      </div>

      {/* 탭 + 테이블 */}
      <div className="rounded-lg bg-white shadow-sm border border-gray-200">
        <div className="flex border-b border-gray-200">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">병원명</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">판정</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">점수</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">검증 소스</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">검증일</th>
                <th className="px-4 py-3 text-sm font-semibold text-gray-600">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <BranchRow
                  key={b.id}
                  branch={b}
                  onVerify={handleVerify}
                  onRemove={handleRemove}
                  verifying={verifying}
                />
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            해당 조건의 지점이 없습니다.
          </div>
        )}
      </div>

      {/* 메모 */}
      {network.notes && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-medium text-amber-800">메모</p>
          <p className="mt-1 text-sm text-amber-700">{network.notes}</p>
        </div>
      )}
    </div>
  );
}
