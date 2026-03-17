import type { ReactNode } from 'react';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSalesDashboard, type EmailStatus, type SalesLeadStatus } from '../../hooks/use-dashboard';
import { useMultiRealtime } from '../../hooks/use-realtime';

// ─── 상수 ────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-red-500 text-white',
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-400 text-white',
};

const INTEREST_COLORS: Record<string, string> = {
  hot: 'text-red-600 font-semibold',
  warm: 'text-orange-500 font-medium',
  warming: 'text-yellow-600',
  cold: 'text-slate-400',
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

const EMAIL_STATUS_CONFIG: Record<EmailStatus, { label: string; className: string; dot: string }> = {
  none:    { label: '미발송', className: 'bg-gray-100 text-gray-500', dot: 'bg-gray-300' },
  queued:  { label: '대기중', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  sent:    { label: '발송됨', className: 'bg-blue-50 text-blue-600', dot: 'bg-blue-400' },
  opened:  { label: '열람됨', className: 'bg-green-50 text-green-700', dot: 'bg-green-500' },
  clicked: { label: '클릭됨', className: 'bg-purple-50 text-purple-700', dot: 'bg-purple-500' },
  bounced: { label: '반송됨', className: 'bg-red-50 text-red-600', dot: 'bg-red-400' },
};

const GRADE_OPTIONS = ['', 'S', 'A', 'B', 'C'];
const STAGE_FILTER_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'active', label: '활성 영업건' },
  { value: 'new', label: '신규' },
  { value: 'contacted', label: '연락완료' },
  { value: 'responded', label: '응답' },
  { value: 'demo_scheduled', label: '데모예정' },
  { value: 'demo_done', label: '데모완료' },
  { value: 'proposal', label: '제안' },
  { value: 'negotiation', label: '협상' },
];
const EMAIL_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: '전체' },
  { value: 'none', label: '미발송' },
  { value: 'sent', label: '발송됨' },
  { value: 'opened', label: '열람됨' },
  { value: 'clicked', label: '클릭됨' },
  { value: 'bounced', label: '반송됨' },
];

// ─── KPI 카드 ─────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: number;
  accent: string;
  sub?: string;
}

function KpiCard({ label, value, accent, sub }: KpiProps): ReactNode {
  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value.toLocaleString()}</p>
      {sub && <p className="mt-0.5 text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

// ─── 행 ──────────────────────────────────────────────────

function LeadRow({ lead }: { lead: SalesLeadStatus }): ReactNode {
  const navigate = useNavigate();
  const emailCfg = EMAIL_STATUS_CONFIG[lead.emailStatus];

  const sentAt = lead.latestEmail?.sentAt
    ? new Date(lead.latestEmail.sentAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <tr
      onClick={() => navigate(`/leads/${lead.leadId}`)}
      className="cursor-pointer hover:bg-slate-50 transition-colors"
    >
      {/* 등급 */}
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-bold ${GRADE_COLORS[lead.grade ?? ''] ?? 'bg-gray-200 text-gray-600'}`}>
          {lead.grade ?? '-'}
        </span>
      </td>

      {/* 병원 / 제품 */}
      <td className="px-4 py-2.5">
        <p className="max-w-[160px] truncate text-sm font-medium text-gray-900">{lead.hospitalName}</p>
        <p className="max-w-[160px] truncate text-xs text-gray-400">{lead.productName}</p>
      </td>

      {/* 지역 */}
      <td className="px-4 py-2.5 text-xs text-gray-500">{lead.region ?? '-'}</td>

      {/* 단계 */}
      <td className="px-4 py-2.5">
        <span className="text-xs text-gray-700">{STAGE_LABELS[lead.stage] ?? lead.stage}</span>
      </td>

      {/* 관심도 */}
      <td className="px-4 py-2.5">
        <span className={`text-xs ${INTEREST_COLORS[lead.interestLevel ?? ''] ?? 'text-gray-500'}`}>
          {lead.interestLevel ?? '-'}
        </span>
      </td>

      {/* 이메일 현황 */}
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${emailCfg.className}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${emailCfg.dot}`} />
          {emailCfg.label}
        </span>
      </td>

      {/* 발송 수 */}
      <td className="px-4 py-2.5 text-center text-xs text-gray-500">
        {lead.emailCount > 0 ? `${lead.emailCount}회` : '-'}
      </td>

      {/* 최근 제목 */}
      <td className="px-4 py-2.5">
        <p className="max-w-[180px] truncate text-xs text-gray-600">
          {lead.latestEmail?.subject ?? <span className="text-gray-300 italic">-</span>}
        </p>
      </td>

      {/* 발송일시 */}
      <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
        {sentAt ?? '-'}
      </td>

      {/* 오픈/클릭 */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          {lead.latestEmail?.opened && (
            <span className="rounded bg-green-100 px-1 py-0.5 text-[10px] font-medium text-green-700">오픈</span>
          )}
          {lead.latestEmail?.clicked && (
            <span className="rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium text-purple-700">클릭</span>
          )}
          {!lead.latestEmail?.opened && !lead.latestEmail?.clicked && (
            <span className="text-xs text-gray-300">-</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── 메인 ─────────────────────────────────────────────────

export function SalesDashboard(): ReactNode {
  const [stageFilter, setStageFilter] = useState('active');
  const [gradeFilter, setGradeFilter] = useState('');
  const [emailStatusFilter, setEmailStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, loading, error, refetch } = useSalesDashboard({
    stage: stageFilter,
    grade: gradeFilter,
  });

  // 실시간 구독
  const handleChange = useCallback(() => { void refetch(); }, [refetch]);
  useMultiRealtime(['sales_emails', 'sales_email_events', 'sales_leads'], handleChange);

  // 클라이언트 필터 (이메일 상태, 검색)
  const filtered = (data?.leads ?? []).filter(lead => {
    if (emailStatusFilter && lead.emailStatus !== emailStatusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!lead.hospitalName.toLowerCase().includes(q) && !(lead.contactEmail ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const kpi = data?.kpi;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">영업건별 이메일 현황</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            실시간
          </span>
          {!loading && (
            <span className="text-xs text-gray-400">{filtered.length}건</span>
          )}
        </div>
      </div>

      {/* KPI 카드 */}
      {kpi && (
        <div className="grid grid-cols-5 gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3">
          <KpiCard label="전체 영업건" value={kpi.total} accent="text-gray-900" />
          <KpiCard label="오늘 발송" value={kpi.sentToday} accent="text-blue-600" sub="금일 기준" />
          <KpiCard label="열람됨" value={kpi.opened} accent="text-green-600" sub="최신 이메일" />
          <KpiCard label="클릭됨" value={kpi.clicked} accent="text-purple-600" sub="최신 이메일" />
          <KpiCard label="미발송" value={kpi.noEmail} accent="text-orange-500" sub="이메일 없음" />
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-2">
        {/* 단계 필터 */}
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {STAGE_FILTER_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* 등급 필터 */}
        <div className="flex gap-0.5">
          {GRADE_OPTIONS.map(g => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                gradeFilter === g
                  ? 'bg-slate-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {g === '' ? '전체' : g}
            </button>
          ))}
        </div>

        {/* 이메일 상태 필터 */}
        <div className="flex gap-0.5">
          {EMAIL_STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setEmailStatusFilter(f.value)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                emailStatusFilter === f.value
                  ? 'bg-blue-600 text-white font-medium'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <input
          type="text"
          placeholder="병원명 / 이메일 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ml-auto rounded border border-gray-200 px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        {loading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        )}
        {error && (
          <div className="p-6 text-center text-sm text-red-500">{error}</div>
        )}
        {!loading && !error && (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">등급</th>
                <th className="px-4 py-2 text-left">병원 / 제품</th>
                <th className="px-4 py-2 text-left">지역</th>
                <th className="px-4 py-2 text-left">단계</th>
                <th className="px-4 py-2 text-left">관심도</th>
                <th className="px-4 py-2 text-left">이메일 상태</th>
                <th className="px-4 py-2 text-center">발송횟수</th>
                <th className="px-4 py-2 text-left">최근 메일 제목</th>
                <th className="px-4 py-2 text-left">발송일시</th>
                <th className="px-4 py-2 text-left">반응</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    해당하는 영업건이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map(lead => <LeadRow key={lead.leadId} lead={lead} />)
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
