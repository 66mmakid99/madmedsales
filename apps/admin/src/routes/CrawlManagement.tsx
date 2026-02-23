import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrawlStats, useCrawls } from '../hooks/use-crawls';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function getNextScheduleDate(): string {
  const now = new Date();
  const scheduleDays = [1, 8, 15, 22, 29];
  const y = now.getFullYear();
  const m = now.getMonth();
  for (const d of scheduleDays) {
    const candidate = new Date(y, m, d);
    if (candidate > now) return candidate.toLocaleDateString('ko-KR');
  }
  const nextMonth = new Date(y, m + 1, 1);
  return nextMonth.toLocaleDateString('ko-KR');
}

export function CrawlManagement(): ReactNode {
  const navigate = useNavigate();
  const { data: stats, loading: statsLoading } = useCrawlStats();
  const [page, setPage] = useState(1);
  const { data: crawlData, loading: crawlLoading, error } = useCrawls(page);

  const crawls = crawlData?.crawls ?? [];
  const totalPages = crawlData?.totalPages ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800">크롤 관리</h2>
        <p className="mt-1 text-sm text-slate-500">크롤링 현황 및 관리</p>

      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-200" />
          ))
        ) : stats ? (
          <>
            <KpiCard label="총 크롤" value={stats.totalCrawls.toLocaleString()} sub="전체 기간" />
            <KpiCard label="성공률" value={stats.totalCrawls > 0 ? `${Math.round((stats.successCount / stats.totalCrawls) * 100)}%` : '-'} sub={`${stats.successCount}/${stats.totalCrawls}`} />
            <KpiCard label="평균 소요" value={stats.avgDuration} sub="크롤당" />
            <KpiCard label="이번달 비용" value={`₩${stats.totalCost.toLocaleString()}`} sub="Gemini API" />
          </>
        ) : null}
      </div>

      {/* Crawl Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm">
        {crawlLoading && <div className="p-8 text-center text-slate-400">로딩 중...</div>}
        {error && <div className="p-8 text-center text-red-500">{error}</div>}
        {!crawlLoading && !error && (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">병원명</th>
                <th className="px-4 py-3 font-medium">일시</th>
                <th className="px-4 py-3 font-medium">방식</th>
                <th className="px-4 py-3 text-center font-medium">장비</th>
                <th className="px-4 py-3 text-center font-medium">시술</th>
                <th className="px-4 py-3 text-center font-medium">가격</th>
                <th className="px-4 py-3 text-center font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {crawls.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">크롤 기록이 없습니다</td></tr>
              )}
              {crawls.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/hospitals/${c.hospitalId}`)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{c.hospitalName}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(c.crawlDate)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-slate-500">{c.method}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{c.equipmentCount}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{c.treatmentCount}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{c.pricingCount}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      c.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {c.status === 'success' ? '✅ 성공' : '❌ 실패'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded border px-3 py-1 text-sm disabled:opacity-40">이전</button>
          <span className="text-sm text-slate-500">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded border px-3 py-1 text-sm disabled:opacity-40">다음</button>
        </div>
      )}

      {/* Schedule & Infra Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-800">크롤 스케줄</h3>
          <div className="space-y-2 text-sm text-slate-500">
            <p>매월 1, 8, 15, 22, 29일 자동 실행</p>
            <p>다음 실행: <span className="font-medium text-slate-800">{getNextScheduleDate()}</span></p>
            <p>대상: 상위 2,700개 병원</p>
            <p>예상 비용: <span className="font-medium">₩40,000</span></p>
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-800">인프라 상태</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Oracle VM</span>
              <span className="text-red-500">❌ 미생성</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Firecrawl</span>
              <span className="text-amber-500">⚠️ 클라우드 크레딧 사용 중</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Gemini API</span>
              <span className="text-emerald-600">✅ 정상</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }): ReactNode {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-800">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}
