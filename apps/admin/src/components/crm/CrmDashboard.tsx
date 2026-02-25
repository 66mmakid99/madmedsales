import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCrmHospitalSummary } from '../../hooks/use-crm-hospitals';

function StatCard({ label, value, accent, sub }: { label: string; value: number; accent?: string; sub?: string }): ReactNode {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub ? <p className="text-xs text-gray-400 mt-1">{sub}</p> : null}
    </div>
  );
}

export function CrmDashboard(): ReactNode {
  const { data: summary, loading, error } = useCrmHospitalSummary();

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
      <h1 className="text-2xl font-bold text-gray-900">CRM 대시보드</h1>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="총 고객 병원" value={summary?.total ?? 0} />
        <StatCard label="VIP 고객" value={summary?.byGrade.VIP ?? 0} accent="text-purple-600" />
        <StatCard label="A등급" value={summary?.byGrade.A ?? 0} accent="text-blue-600" />
        <StatCard
          label="주의/위험"
          value={summary?.attentionCount ?? 0}
          accent={summary?.attentionCount ? 'text-red-600' : 'text-gray-400'}
          sub="orange + red"
        />
      </div>

      {/* 건강도 분포 */}
      {summary && summary.total > 0 ? (
        <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-600 mb-3">건강도 분포</h2>
          <div className="flex gap-3">
            {([
              { key: 'green', label: '건강', color: 'bg-green-500' },
              { key: 'yellow', label: '보통', color: 'bg-yellow-400' },
              { key: 'orange', label: '주의', color: 'bg-orange-500' },
              { key: 'red', label: '위험', color: 'bg-red-500' },
            ] as const).map(({ key, label, color }) => {
              const count = summary.byHealth[key];
              const pct = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
              return (
                <div key={key} className="flex-1">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>{label}</span>
                    <span>{count}개 ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 등급 분포 */}
      {summary && summary.total > 0 ? (
        <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-600 mb-3">등급 분포</h2>
          <div className="grid grid-cols-4 gap-3">
            {([
              { grade: 'VIP', color: 'bg-purple-100 text-purple-700' },
              { grade: 'A', color: 'bg-blue-100 text-blue-700' },
              { grade: 'B', color: 'bg-gray-100 text-gray-700' },
              { grade: 'C', color: 'bg-yellow-100 text-yellow-700' },
            ] as const).map(({ grade, color }) => (
              <div key={grade} className={`rounded-lg p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{summary.byGrade[grade]}</p>
                <p className="text-xs font-medium">{grade}등급</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 빠른 이동 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Link
          to="/crm/hospitals"
          className="rounded-lg bg-white p-5 shadow-sm border border-gray-100 hover:border-blue-300 transition-colors"
        >
          <p className="text-lg font-semibold text-gray-900">고객 병원</p>
          <p className="text-sm text-gray-500 mt-1">병원 목록 및 상세 관리</p>
        </Link>
        <Link
          to="/crm/products"
          className="rounded-lg bg-white p-5 shadow-sm border border-gray-100 hover:border-blue-300 transition-colors"
        >
          <p className="text-lg font-semibold text-gray-900">제품 관리</p>
          <p className="text-sm text-gray-500 mt-1">자사 장비 및 소모품 관리</p>
        </Link>
      </div>
    </div>
  );
}
