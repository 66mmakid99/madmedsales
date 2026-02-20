import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDemos } from '../../hooks/use-demos';
import { DEMO_STATUSES } from '@madmedsales/shared';

const STATUS_LABELS: Record<string, string> = {
  requested: '요청됨',
  confirmed: '확정',
  preparing: '준비중',
  in_progress: '진행중',
  completed: '완료',
  evaluated: '평가완료',
  cancelled: '취소',
};

const STATUS_COLORS: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  preparing: 'bg-purple-100 text-purple-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  evaluated: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const TYPE_LABELS: Record<string, string> = {
  online: '온라인',
  visit: '방문',
  self_video: '셀프영상',
};

const PAGE_SIZE = 20;

export function DemoList(): ReactNode {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

  const { data, loading, error } = useDemos({
    status: statusFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const demos = data?.demos ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">데모 관리</h2>
        <span className="text-sm text-gray-500">총 {total}건</span>
      </div>

      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">전체 상태</option>
          {DEMO_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        {loading && <div className="p-8 text-center text-gray-400">로딩 중...</div>}
        {error && <div className="p-8 text-center text-red-500">{error}</div>}
        {!loading && !error && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">병원</th>
                <th className="px-4 py-3">유형</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">예정일</th>
                <th className="px-4 py-3">담당자</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {demos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    데모가 없습니다.
                  </td>
                </tr>
              )}
              {demos.map((demo) => (
                <tr
                  key={demo.id}
                  onClick={() => navigate(`/demos/${demo.id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {demo.hospital_id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {TYPE_LABELS[demo.demo_type] ?? demo.demo_type}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[demo.status] ?? 'bg-gray-100'}`}>
                      {STATUS_LABELS[demo.status] ?? demo.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {demo.scheduled_at
                      ? new Date(demo.scheduled_at).toLocaleString('ko-KR')
                      : '미정'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {demo.assigned_to ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm text-gray-600">{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
