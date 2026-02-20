import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHospitals } from '../../hooks/use-hospitals';

const PAGE_SIZE = 20;

export function HospitalList(): ReactNode {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sido, setSido] = useState('');
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(0);

  const { data, loading, error } = useHospitals({
    search: search || undefined,
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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">병원 DB</h2>
        <span className="text-sm text-gray-500">총 {total}건</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="병원명 검색..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <select
          value={sido}
          onChange={(e) => { setSido(e.target.value); setPage(0); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">전체 지역</option>
          <option value="서울특별시">서울</option>
          <option value="경기도">경기</option>
          <option value="부산광역시">부산</option>
          <option value="대구광역시">대구</option>
          <option value="인천광역시">인천</option>
          <option value="광주광역시">광주</option>
          <option value="대전광역시">대전</option>
        </select>
        <select
          value={department}
          onChange={(e) => { setDepartment(e.target.value); setPage(0); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">전체 진료과</option>
          <option value="피부과">피부과</option>
          <option value="성형외과">성형외과</option>
          <option value="의원">의원</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        {loading && <div className="p-8 text-center text-gray-400">로딩 중...</div>}
        {error && <div className="p-8 text-center text-red-500">{error}</div>}
        {!loading && !error && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">병원명</th>
                <th className="px-4 py-3">지역</th>
                <th className="px-4 py-3">진료과</th>
                <th className="px-4 py-3">품질점수</th>
                <th className="px-4 py-3">이메일</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hospitals.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    병원이 없습니다.
                  </td>
                </tr>
              )}
              {hospitals.map((hospital) => (
                <tr
                  key={hospital.id}
                  onClick={() => navigate(`/hospitals/${hospital.id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{hospital.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {hospital.sido ?? '-'} {hospital.sigungu ?? ''}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{hospital.department ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 rounded bg-gray-200">
                        <div
                          className="h-2 rounded bg-blue-500"
                          style={{ width: `${hospital.data_quality_score}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{hospital.data_quality_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{hospital.email ?? '-'}</td>
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
