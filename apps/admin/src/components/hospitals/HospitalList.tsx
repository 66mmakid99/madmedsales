import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { useHospitalSummary } from '../../hooks/use-hospitals';
import { ProfiledHospitalTab } from './ProfiledHospitalTab';
import { AllHospitalTab } from './AllHospitalTab';

type Tab = 'profiled' | 'all';

export function HospitalList(): ReactNode {
  const [tab, setTab] = useState<Tab>('profiled');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sido, setSido] = useState('');
  const [department, setDepartment] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: summary } = useHospitalSummary();

  // Debounce search input (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-slate-800">병원 DB</h2>
        <p className="mt-0.5 text-sm text-slate-500">데이터 수집 및 프로파일링 현황</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label="프로파일링 완료"
          value={summary?.profiled ?? 0}
          color="violet"
          icon={<CheckCircleIcon />}
        />
        <SummaryCard
          label="크롤만 완료"
          value={summary?.crawledOnly ?? 0}
          color="blue"
          icon={<CrawlIcon />}
        />
        <SummaryCard
          label="미수집"
          value={summary?.uncollected ?? 0}
          color="gray"
          icon={<EmptyIcon />}
        />
      </div>

      {/* Tab + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-white p-0.5 shadow-sm">
          <TabButton active={tab === 'profiled'} onClick={() => setTab('profiled')}>
            프로파일링 완료
            {summary ? <span className="ml-1 text-xs opacity-60">({summary.profiled})</span> : null}
          </TabButton>
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            전체 병원
            {summary ? <span className="ml-1 text-xs opacity-60">({summary.total})</span> : null}
          </TabButton>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="병원명 검색..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <select
            value={sido}
            onChange={(e) => setSido(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">전체 지역</option>
            <option value="서울">서울</option>
            <option value="경기">경기</option>
            <option value="인천">인천</option>
            <option value="부산">부산</option>
            <option value="대구">대구</option>
            <option value="광주">광주</option>
            <option value="대전">대전</option>
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">전체 진료과</option>
            <option value="피부과">피부과</option>
            <option value="성형외과">성형외과</option>
            <option value="의원">의원</option>
          </select>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'profiled' ? (
        <ProfiledHospitalTab searchQuery={searchQuery} sido={sido} department={department} />
      ) : (
        <AllHospitalTab searchQuery={searchQuery} sido={sido} department={department} />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-slate-800 text-white'
          : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: ReactNode }): ReactNode {
  const colorMap: Record<string, string> = {
    violet: 'border-violet-200 bg-violet-50',
    blue: 'border-blue-200 bg-blue-50',
    gray: 'border-gray-200 bg-gray-50',
  };
  const textMap: Record<string, string> = {
    violet: 'text-violet-700',
    blue: 'text-blue-700',
    gray: 'text-slate-500',
  };
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-4 ${colorMap[color] ?? colorMap.gray}`}>
      <div className={`${textMap[color] ?? textMap.gray}`}>{icon}</div>
      <div>
        <div className={`text-xl font-bold ${textMap[color] ?? textMap.gray}`}>
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

/* ── SVG Icons ── */

function CheckCircleIcon(): ReactNode {
  return (
    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CrawlIcon(): ReactNode {
  return (
    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function EmptyIcon(): ReactNode {
  return (
    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}
