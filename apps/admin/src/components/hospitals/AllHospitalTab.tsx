import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEnrichedHospitals } from '../../hooks/use-hospitals';

const PAGE_SIZE = 20;

interface Props {
  searchQuery: string;
  sido: string;
  department: string;
}

export function AllHospitalTab({ searchQuery, sido, department }: Props): ReactNode {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const prevFilters = useRef({ searchQuery, sido, department });

  useEffect(() => {
    if (
      prevFilters.current.searchQuery !== searchQuery ||
      prevFilters.current.sido !== sido ||
      prevFilters.current.department !== department
    ) {
      setPage(0);
      prevFilters.current = { searchQuery, sido, department };
    }
  }, [searchQuery, sido, department]);

  const { data, loading, error } = useEnrichedHospitals({
    search: searchQuery || undefined,
    sido: sido || undefined,
    department: department || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const hospitals = data?.hospitals ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm">
        {loading && <div className="p-8 text-center text-slate-400">로딩 중...</div>}
        {error && <div className="p-8 text-center text-red-500">{error}</div>}
        {!loading && !error && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">병원명</th>
                <th className="px-4 py-3 font-medium">지역</th>
                <th className="px-4 py-3 font-medium">진료과</th>
                <th className="px-4 py-3 font-medium">품질점수</th>
                <th className="px-4 py-3 font-medium">이메일</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hospitals.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    병원이 없습니다.
                  </td>
                </tr>
              )}
              {hospitals.map((hospital) => (
                <tr
                  key={hospital.id}
                  onClick={() => navigate(`/hospitals/${hospital.id}`)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <span className="flex items-center gap-2">
                      {hospital.is_profiled && (
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="프로파일링 완료" />
                      )}
                      {hospital.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {hospital.sido ?? '-'} {hospital.sigungu ?? ''}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{hospital.department ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 rounded bg-gray-200">
                        <div
                          className="h-2 rounded bg-blue-500"
                          style={{ width: `${hospital.data_quality_score}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500">{hospital.data_quality_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{hospital.email ?? '-'}</td>
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
          <span className="text-sm text-slate-500">{page + 1} / {totalPages}</span>
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
