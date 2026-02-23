import type { ReactNode } from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfiledHospitals, type ProfiledHospital } from '../../hooks/use-hospitals';

const PAGE_SIZE = 20;

const PROFILE_GRADE_COLORS: Record<string, string> = {
  PRIME: 'bg-purple-50 text-purple-700 border-purple-200',
  HIGH: 'bg-blue-50 text-blue-700 border-blue-200',
  MID: 'bg-green-50 text-green-700 border-green-200',
  LOW: 'bg-gray-50 text-gray-500 border-gray-200',
};

const MATCH_GRADE_COLORS: Record<string, string> = {
  S: 'bg-purple-50 text-purple-700',
  A: 'bg-blue-50 text-blue-700',
  B: 'bg-green-50 text-green-700',
  C: 'bg-amber-50 text-amber-700',
};

const GRADE_ORDER: Record<string, number> = {
  PRIME: 4, HIGH: 3, MID: 2, LOW: 1,
  S: 4, A: 3, B: 2, C: 1,
};

type SortKey = 'name' | 'equipment_count' | 'treatment_count' | 'pricing_count' | 'profile_grade' | 'best_match_grade' | 'last_crawled_at';
type SortDir = 'asc' | 'desc';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function compareFn(a: ProfiledHospital, b: ProfiledHospital, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case 'name':
      cmp = (a.name ?? '').localeCompare(b.name ?? '', 'ko');
      break;
    case 'equipment_count':
      cmp = a.equipment_count - b.equipment_count;
      break;
    case 'treatment_count':
      cmp = a.treatment_count - b.treatment_count;
      break;
    case 'pricing_count':
      cmp = a.pricing_count - b.pricing_count;
      break;
    case 'profile_grade':
      cmp = (GRADE_ORDER[a.profile_grade ?? ''] ?? 0) - (GRADE_ORDER[b.profile_grade ?? ''] ?? 0);
      break;
    case 'best_match_grade':
      cmp = (GRADE_ORDER[a.best_match_grade ?? ''] ?? 0) - (GRADE_ORDER[b.best_match_grade ?? ''] ?? 0);
      break;
    case 'last_crawled_at':
      cmp = (a.last_crawled_at ?? '').localeCompare(b.last_crawled_at ?? '');
      break;
  }
  return dir === 'asc' ? cmp : -cmp;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }): ReactNode {
  if (!active) {
    return <span className="ml-0.5 text-slate-300">↕</span>;
  }
  return <span className="ml-0.5">{dir === 'asc' ? '▲' : '▼'}</span>;
}

interface Props {
  searchQuery: string;
  sido: string;
  department: string;
}

export function ProfiledHospitalTab({ searchQuery, sido, department }: Props): ReactNode {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const prevFilters = useRef({ searchQuery, sido, department });

  useEffect(() => {
    if (
      prevFilters.current.searchQuery !== searchQuery ||
      prevFilters.current.sido !== sido ||
      prevFilters.current.department !== department
    ) {
      setPage(0);
      setSelected(new Set());
      prevFilters.current = { searchQuery, sido, department };
    }
  }, [searchQuery, sido, department]);

  const { data, loading, error } = useProfiledHospitals({
    search: searchQuery || undefined,
    sido: sido || undefined,
    department: department || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rawHospitals = data?.hospitals ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const hospitals = useMemo(() => {
    if (!sortKey) return rawHospitals;
    return [...rawHospitals].sort((a, b) => compareFn(a, b, sortKey, sortDir));
  }, [rawHospitals, sortKey, sortDir]);

  const allSelected = hospitals.length > 0 && hospitals.every((h) => selected.has(h.id));

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function toggleAll(): void {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(hospitals.map((h) => h.id)));
    }
  }

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function showToast(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  function thClass(key: SortKey, center?: boolean): string {
    return `px-3 py-3 font-medium cursor-pointer select-none transition-colors hover:text-slate-800${center ? ' text-center' : ''}`;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm">
        {loading && <div className="p-8 text-center text-slate-400">로딩 중...</div>}
        {error && <div className="p-8 text-center text-red-500">{error}</div>}
        {!loading && !error && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                </th>
                <th className={thClass('name')} onClick={() => handleSort('name')}>
                  병원명<SortIcon active={sortKey === 'name'} dir={sortDir} />
                </th>
                <th className="px-3 py-3 font-medium">지역</th>
                <th className="px-3 py-3 font-medium">과</th>
                <th className={thClass('equipment_count', true)} onClick={() => handleSort('equipment_count')}>
                  장비<SortIcon active={sortKey === 'equipment_count'} dir={sortDir} />
                </th>
                <th className={thClass('treatment_count', true)} onClick={() => handleSort('treatment_count')}>
                  시술<SortIcon active={sortKey === 'treatment_count'} dir={sortDir} />
                </th>
                <th className={thClass('pricing_count', true)} onClick={() => handleSort('pricing_count')}>
                  가격<SortIcon active={sortKey === 'pricing_count'} dir={sortDir} />
                </th>
                <th className={thClass('profile_grade', true)} onClick={() => handleSort('profile_grade')}>
                  등급<SortIcon active={sortKey === 'profile_grade'} dir={sortDir} />
                </th>
                <th className={thClass('best_match_grade', true)} onClick={() => handleSort('best_match_grade')}>
                  매칭<SortIcon active={sortKey === 'best_match_grade'} dir={sortDir} />
                </th>
                <th className={thClass('last_crawled_at', true)} onClick={() => handleSort('last_crawled_at')}>
                  크롤일<SortIcon active={sortKey === 'last_crawled_at'} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hospitals.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    프로파일링된 병원이 없습니다.
                  </td>
                </tr>
              )}
              {hospitals.map((h) => (
                <tr
                  key={h.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(h.id)}
                      onChange={() => toggleOne(h.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-3 font-medium text-slate-800" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    {h.name}
                  </td>
                  <td className="px-3 py-3 text-slate-500" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    {h.sido ?? '-'} {h.sigungu ?? ''}
                  </td>
                  <td className="px-3 py-3 text-slate-500" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    {h.department ?? '-'}
                  </td>
                  <td className="px-3 py-3 text-center" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    <span className="inline-block min-w-[2rem] rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {h.equipment_count}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    <span className="inline-block min-w-[2rem] rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {h.treatment_count}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    <span className="inline-block min-w-[2rem] rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {h.pricing_count}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    {h.profile_grade ? (
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${PROFILE_GRADE_COLORS[h.profile_grade] ?? 'bg-gray-50 text-gray-500'}`}>
                        {h.profile_grade}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-3 text-center" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    {h.best_match_grade ? (
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${MATCH_GRADE_COLORS[h.best_match_grade] ?? 'bg-gray-100 text-gray-500'}`}>
                        {h.best_match_grade}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-xs text-slate-400" onClick={() => navigate(`/hospitals/${h.id}`)}>
                    {formatDate(h.last_crawled_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
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

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-4 rounded-xl border border-gray-200 bg-white px-6 py-3 shadow-lg">
          <span className="text-sm font-medium text-slate-800">{selected.size}건 선택됨</span>
          <button
            onClick={() => showToast('크롤 재실행 기능은 준비 중입니다')}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-gray-50"
          >
            크롤 재실행
          </button>
          <button
            onClick={() => showToast('리드 전환은 Phase 3에서 활성화됩니다')}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            리드로 전환
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
