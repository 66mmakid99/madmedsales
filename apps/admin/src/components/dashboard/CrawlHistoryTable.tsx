import type { ReactNode } from 'react';
import type { CrawlHistoryItem } from '../../hooks/use-dashboard';

interface Props {
  crawls: CrawlHistoryItem[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CrawlHistoryTable({ crawls }: Props): ReactNode {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-800">최근 크롤 히스토리</h3>
      </div>
      {crawls.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">크롤 기록이 없습니다</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-xs text-gray-500">
                <th className="px-5 py-3 font-medium">병원명</th>
                <th className="px-3 py-3 font-medium">크롤 일시</th>
                <th className="px-3 py-3 text-center font-medium">장비</th>
                <th className="px-3 py-3 text-center font-medium">시술</th>
                <th className="px-3 py-3 text-center font-medium">가격</th>
                <th className="px-3 py-3 font-medium">변동 사항</th>
                <th className="px-3 py-3 text-center font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {crawls.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-gray-50/50">
                  <td className="px-5 py-3 font-medium text-gray-800">{c.hospitalName}</td>
                  <td className="px-3 py-3 text-gray-500">{formatDate(c.crawledAt)}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {c.equipmentsCount}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {c.treatmentsCount}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {c.pricingCount}
                    </span>
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-3 text-xs text-gray-500">
                    {c.diffSummary ?? '-'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      c.status === 'success'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${c.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {c.status === 'success' ? '성공' : '실패'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
