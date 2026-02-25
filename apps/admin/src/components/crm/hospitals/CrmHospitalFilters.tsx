import { type ReactNode, useState, useEffect } from 'react';

interface CrmHospitalFiltersProps {
  onFilterChange: (filters: {
    search: string;
    region: string;
    customer_grade: string;
    health_status: string;
  }) => void;
}

const REGIONS = ['', '서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const GRADES = ['', 'VIP', 'A', 'B', 'C'];
const HEALTH = ['', 'green', 'yellow', 'orange', 'red'];
const HEALTH_LABELS: Record<string, string> = { green: '건강', yellow: '보통', orange: '주의', red: '위험' };

export function CrmHospitalFilters({ onFilterChange }: CrmHospitalFiltersProps): ReactNode {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [grade, setGrade] = useState('');
  const [health, setHealth] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      onFilterChange({ search, region, customer_grade: grade, health_status: health });
    }, 300);
    return (): void => { clearTimeout(timer); };
  }, [search, region, grade, health, onFilterChange]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        placeholder="병원명 검색..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
      />
      <select
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="">전체 지역</option>
        {REGIONS.filter(Boolean).map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <select
        value={grade}
        onChange={(e) => setGrade(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="">전체 등급</option>
        {GRADES.filter(Boolean).map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
      <select
        value={health}
        onChange={(e) => setHealth(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="">전체 건강도</option>
        {HEALTH.filter(Boolean).map((h) => (
          <option key={h} value={h}>{HEALTH_LABELS[h] ?? h}</option>
        ))}
      </select>
    </div>
  );
}
