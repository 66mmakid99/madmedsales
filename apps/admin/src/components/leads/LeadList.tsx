import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeads } from '../../hooks/use-leads';
import { LeadFilters } from './LeadFilters';

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-red-500 text-white',
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-500 text-white',
};

const INTEREST_COLORS: Record<string, string> = {
  hot: 'text-red-600',
  warm: 'text-orange-600',
  warming: 'text-yellow-600',
  cold: 'text-blue-600',
};

const STAGE_LABELS: Record<string, string> = {
  new: '신규',
  contacted: '연락완료',
  responded: '응답',
  kakao_connected: '카카오',
  demo_scheduled: '데모예정',
  demo_done: '데모완료',
  proposal: '제안',
  negotiation: '협상',
  closed_won: '성사',
  closed_lost: '실패',
  nurturing: '육성',
};

const PAGE_SIZE = 20;

export function LeadList(): ReactNode {
  const navigate = useNavigate();
  const [grade, setGrade] = useState('');
  const [stage, setStage] = useState('');
  const [interestLevel, setInterestLevel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, loading, error } = useLeads({
    grade: grade || undefined,
    stage: stage || undefined,
    interest_level: interestLevel || undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">리드 관리</h2>
        <span className="text-sm text-gray-500">총 {total}건</span>
      </div>

      <div className="mb-4">
        <LeadFilters
          grade={grade}
          stage={stage}
          interestLevel={interestLevel}
          search={search}
          onGradeChange={setGrade}
          onStageChange={setStage}
          onInterestLevelChange={setInterestLevel}
          onSearchChange={setSearch}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        {loading && <div className="p-8 text-center text-gray-400">로딩 중...</div>}
        {error && <div className="p-8 text-center text-red-500">{error}</div>}
        {!loading && !error && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">등급</th>
                <th className="px-4 py-3">병원</th>
                <th className="px-4 py-3">단계</th>
                <th className="px-4 py-3">관심도</th>
                <th className="px-4 py-3">이메일</th>
                <th className="px-4 py-3">최근활동</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    리드가 없습니다.
                  </td>
                </tr>
              )}
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => navigate(`/leads/${lead.id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${GRADE_COLORS[lead.grade ?? ''] ?? 'bg-gray-200 text-gray-700'}`}>
                      {lead.grade ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {lead.contact_name ?? '미정'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {STAGE_LABELS[lead.stage] ?? lead.stage}
                  </td>
                  <td className={`px-4 py-3 font-medium ${INTEREST_COLORS[lead.interest_level] ?? 'text-gray-600'}`}>
                    {lead.interest_level}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {lead.contact_email ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(lead.updated_at).toLocaleDateString('ko-KR')}
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
          <span className="text-sm text-gray-600">
            {page + 1} / {totalPages}
          </span>
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
