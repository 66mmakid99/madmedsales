import type { ReactNode } from 'react';
import { useState } from 'react';
import { useApi } from '../../hooks/use-api';
import type { Email } from '@madmedsales/shared';
import { EMAIL_STATUSES } from '@madmedsales/shared';

interface EmailListResult {
  emails: Email[];
  total: number;
}

const STATUS_LABELS: Record<string, string> = {
  queued: '대기',
  sent: '발송됨',
  delivered: '도달',
  bounced: '반송',
  failed: '실패',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  bounced: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
};

const PAGE_SIZE = 20;

export function EmailList(): ReactNode {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(page * PAGE_SIZE));

  const { data, loading, error } = useApi<EmailListResult>(
    `/api/emails?${params.toString()}`
  );

  const emails = data?.emails ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">이메일 관리</h2>
        <span className="text-sm text-gray-500">총 {total}건</span>
      </div>

      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">전체 상태</option>
          {EMAIL_STATUSES.map((s) => (
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
                <th className="px-4 py-3">제목</th>
                <th className="px-4 py-3">수신자</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">발송일</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {emails.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                    이메일이 없습니다.
                  </td>
                </tr>
              )}
              {emails.map((email) => (
                <tr key={email.id} className="hover:bg-gray-50">
                  <td className="max-w-xs truncate px-4 py-3 font-medium text-gray-900">
                    {email.subject}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{email.to_email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[email.status] ?? 'bg-gray-100'}`}>
                      {STATUS_LABELS[email.status] ?? email.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {email.sent_at
                      ? new Date(email.sent_at).toLocaleString('ko-KR')
                      : '-'}
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
