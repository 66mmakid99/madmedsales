// v1.0 - 2026-02-21
// compound_words 시딩 데이터의 TypeScript 소스
// Migration 014의 INSERT도 이 파일 기반으로 생성

export interface CompoundWordEntry {
  compoundName: string;
  decomposedNames: string[];
  scoringNote: string;
}

export const COMPOUND_WORDS: CompoundWordEntry[] = [
  {
    compoundName: '울써마지',
    decomposedNames: ['울쎄라', '써마지'],
    scoringNote: '고가 브릿지, 프리미엄 패키지',
  },
  {
    compoundName: '인슈링크',
    decomposedNames: ['인모드', '슈링크'],
    scoringNote: 'RF+HIFU 컴바인',
  },
  {
    compoundName: '울쥬베',
    decomposedNames: ['울쎄라', '쥬베룩'],
    scoringNote: '리프팅+부스터 패키지',
  },
  {
    compoundName: '써쥬베',
    decomposedNames: ['써마지', '쥬베룩'],
    scoringNote: 'RF+부스터 패키지',
  },
  {
    compoundName: '텐텐',
    decomposedNames: ['텐쎄라', '텐써마'],
    scoringNote: '아이리프팅 특화',
  },
  {
    compoundName: '올리쥬란',
    decomposedNames: ['올리지오', '리쥬란'],
    scoringNote: 'RF+부스터 컴바인',
  },
  {
    compoundName: '슈쥬베',
    decomposedNames: ['슈링크', '쥬베룩'],
    scoringNote: 'HIFU+부스터',
  },
  {
    compoundName: '울포',
    decomposedNames: ['울쎄라', '포텐자'],
    scoringNote: 'HIFU+MRF',
  },
];

/**
 * 텍스트에서 확정 합성어를 찾아 분해된 표준명 배열 반환.
 * 매칭되지 않으면 null.
 */
export function decomposeCompoundWord(text: string): CompoundWordEntry | null {
  const lower = text.toLowerCase();
  for (const entry of COMPOUND_WORDS) {
    if (lower.includes(entry.compoundName.toLowerCase())) {
      return entry;
    }
  }
  return null;
}
