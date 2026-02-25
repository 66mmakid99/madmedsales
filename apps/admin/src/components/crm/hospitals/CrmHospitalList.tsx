import { type ReactNode, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmHospitals, useCrmHospitalSummary } from '../../../hooks/use-crm-hospitals';
import { CrmHospitalFilters } from './CrmHospitalFilters';
import type { CrmHospitalListItem } from '../../../hooks/use-crm-hospitals';

const GRADE_STYLES: Record<string, string> = {
  VIP: 'bg-purple-100 text-purple-700',
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-gray-100 text-gray-600',
  C: 'bg-yellow-100 text-yellow-700',
};

const HEALTH_ICONS: Record<string, { dot: string; label: string }> = {
  green: { dot: 'bg-green-500', label: '정상' },
  yellow: { dot: 'bg-yellow-400', label: '보통' },
  orange: { dot: 'bg-orange-500', label: '주의' },
  red: { dot: 'bg-red-500', label: '위험' },
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return '오늘';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }): ReactNode {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-100">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function HospitalRow({ hospital }: { hospital: CrmHospitalListItem }): ReactNode {
  const navigate = useNavigate();
  const displayName = hospital.branch_name
    ? `${hospital.name} ${hospital.branch_name}`
    : hospital.name;

  const primaryContact = (hospital.crm_contacts ?? []).find((c) => c.is_primary);
  const equipmentList = hospital.crm_equipment ?? [];
  const equipmentSummary = equipmentList.length > 0
    ? `${equipmentList.length}대 (${equipmentList.map((e) => e.product?.name ?? e.model_variant ?? '?').join(', ')})`
    : '-';

  const healthInfo = HEALTH_ICONS[hospital.health_status] ?? { dot: 'bg-gray-300', label: hospital.health_status };
  const lastContactedStyle = hospital.last_contacted_at
    ? (Date.now() - new Date(hospital.last_contacted_at).getTime() > 90 * 24 * 60 * 60 * 1000 ? 'text-red-500 font-medium' : 'text-gray-500')
    : 'text-gray-400';

  return (
    <tr
      onClick={() => navigate(`/crm/hospitals/${hospital.id}`)}
      className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
    >
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{displayName}</p>
        {hospital.franchise ? (
          <p className="text-xs text-gray-400 mt-0.5">{hospital.franchise.name}</p>
        ) : null}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {primaryContact?.name ?? '-'}
        {primaryContact?.role ? <span className="text-xs text-gray-400 ml-1">({primaryContact.role})</span> : null}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{hospital.district ?? hospital.region ?? '-'}</td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${GRADE_STYLES[hospital.customer_grade] ?? ''}`}>
          {hospital.customer_grade}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${healthInfo.dot}`} />
          <span className="text-xs text-gray-500">{healthInfo.label}</span>
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{equipmentSummary}</td>
      <td className={`px-4 py-3 text-xs ${lastContactedStyle}`}>
        {formatRelativeTime(hospital.last_contacted_at)}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 max-w-[120px] truncate">{hospital.notes ?? '-'}</td>
    </tr>
  );
}

export function CrmHospitalList(): ReactNode {
  const [filters, setFilters] = useState({ search: '', region: '', customer_grade: '', health_status: '' });
  const [page, setPage] = useState(1);
  const limit = 20;

  const handleFilterChange = useCallback((newFilters: typeof filters): void => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const { data, loading, error } = useCrmHospitals({
    ...filters,
    page,
    limit,
  });
  const { data: summary } = useCrmHospitalSummary();

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  // 통계 계산 (현재 페이지 기준)
  const monthlyContacted = data?.hospitals.filter((h) => {
    if (!h.last_contacted_at) return false;
    const diff = Date.now() - new Date(h.last_contacted_at).getTime();
    return diff < 30 * 24 * 60 * 60 * 1000;
  }).length ?? 0;

  const snUnconfirmed = data?.hospitals.filter((h) =>
    h.notes?.includes('S/N 미확인')
  ).length ?? 0;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">병원 관리</h1>

      {/* 상단 통계 카드 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="전체 병원수" value={summary?.total ?? 0} />
        <SummaryCard label="이번달 접촉" value={monthlyContacted} accent="text-blue-600" />
        <SummaryCard
          label="주의 필요"
          value={summary?.attentionCount ?? 0}
          accent={summary?.attentionCount ? 'text-red-600' : 'text-gray-400'}
        />
        <SummaryCard
          label="S/N 미확인"
          value={snUnconfirmed}
          accent={snUnconfirmed > 0 ? 'text-orange-600' : 'text-gray-400'}
        />
      </div>

      {/* 필터 */}
      <CrmHospitalFilters onFilterChange={handleFilterChange} />

      {/* 로딩/에러 */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
            <p className="text-gray-400">로딩 중...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 p-4 text-center">
          <p className="text-red-600">{error}</p>
        </div>
      ) : (
        <>
          {/* 테이블 */}
          <div className="rounded-lg bg-white shadow-sm border border-gray-200">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">병원명</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">원장</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">지역</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">등급</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">상태</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">납품 장비</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">마지막 접촉</th>
                    <th className="px-4 py-3 text-sm font-semibold text-gray-600">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.hospitals ?? []).map((h) => (
                    <HospitalRow key={h.id} hospital={h} />
                  ))}
                </tbody>
              </table>
            </div>

            {data && data.hospitals.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                검색 결과가 없습니다.
              </div>
            ) : null}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                총 {data?.total ?? 0}개 중 {(page - 1) * limit + 1}–{Math.min(page * limit, data?.total ?? 0)}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded px-3 py-1 text-sm border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  이전
                </button>
                <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded px-3 py-1 text-sm border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  다음
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
