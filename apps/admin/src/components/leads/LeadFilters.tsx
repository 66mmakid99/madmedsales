import type { ReactNode } from 'react';
import { GRADES, LEAD_STAGES, INTEREST_LEVELS } from '@madmedsales/shared';

interface LeadFiltersProps {
  grade: string;
  stage: string;
  interestLevel: string;
  search: string;
  onGradeChange: (value: string) => void;
  onStageChange: (value: string) => void;
  onInterestLevelChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  new: '신규',
  contacted: '연락완료',
  responded: '응답',
  kakao_connected: '카카오 연결',
  demo_scheduled: '데모예정',
  demo_done: '데모완료',
  proposal: '제안',
  negotiation: '협상',
  closed_won: '성사',
  closed_lost: '실패',
  nurturing: '육성',
};

const INTEREST_LABELS: Record<string, string> = {
  cold: '냉담',
  warming: '관심 시작',
  warm: '따뜻',
  hot: '뜨거움',
};

export function LeadFilters({
  grade,
  stage,
  interestLevel,
  search,
  onGradeChange,
  onStageChange,
  onInterestLevelChange,
  onSearchChange,
}: LeadFiltersProps): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        placeholder="병원명 검색..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <select
        value={grade}
        onChange={(e) => onGradeChange(e.target.value)}
        className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="">전체 등급</option>
        {GRADES.filter((g) => g !== 'EXCLUDE').map((g) => (
          <option key={g} value={g}>{g}등급</option>
        ))}
      </select>
      <select
        value={stage}
        onChange={(e) => onStageChange(e.target.value)}
        className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="">전체 단계</option>
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
        ))}
      </select>
      <select
        value={interestLevel}
        onChange={(e) => onInterestLevelChange(e.target.value)}
        className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="">관심도</option>
        {INTEREST_LEVELS.map((l) => (
          <option key={l} value={l}>{INTEREST_LABELS[l] ?? l}</option>
        ))}
      </select>
    </div>
  );
}
