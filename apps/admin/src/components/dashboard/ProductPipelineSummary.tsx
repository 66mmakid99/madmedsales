import type { ReactNode } from 'react';
import { useRevenueReport } from '../../hooks/use-dashboard';

export function ProductPipelineSummary(): ReactNode {
  const { data, loading } = useRevenueReport();

  if (loading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-200" />;
  }

  if (!data || data.productSummary.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">제품별 파이프라인</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs text-gray-500">
            <tr>
              <th className="pb-2 pr-4">제품</th>
              <th className="pb-2 pr-4 text-right">리드</th>
              <th className="pb-2 pr-4 text-right">HOT</th>
              <th className="pb-2 pr-4 text-right">데모</th>
              <th className="pb-2 pr-4 text-right">이메일</th>
              <th className="pb-2 text-right">성사</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.productSummary.map((p) => (
              <tr key={p.productId}>
                <td className="py-2 pr-4 font-medium text-gray-800">{p.productName}</td>
                <td className="py-2 pr-4 text-right text-gray-600">{p.leads}</td>
                <td className="py-2 pr-4 text-right">
                  {p.hot > 0 ? (
                    <span className="font-medium text-red-600">{p.hot}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right text-gray-600">{p.demos}</td>
                <td className="py-2 pr-4 text-right text-gray-600">{p.emails}</td>
                <td className="py-2 text-right">
                  {p.won > 0 ? (
                    <span className="font-bold text-green-600">{p.won}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 주간 리드 추세 */}
      {data.weeklyLeads.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">주간 리드 추세</p>
          <div className="flex items-end gap-2">
            {data.weeklyLeads.map((w, i) => {
              const max = Math.max(...data.weeklyLeads.map((wl) => wl.count), 1);
              const height = Math.max((w.count / max) * 48, 4);
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-500">{w.count}</span>
                  <div
                    className="w-full rounded bg-blue-400"
                    style={{ height: `${height}px` }}
                  />
                  <span className="text-[9px] text-gray-400">{w.week}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
