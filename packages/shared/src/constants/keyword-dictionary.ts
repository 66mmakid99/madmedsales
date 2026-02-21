// v1.0 - 2026-02-21
// keyword_dictionary 시딩 데이터의 TypeScript 소스
// Migration 014의 INSERT도 이 파일 기반으로 생성

export const UNIT_TYPES = ['SHOT', 'JOULE', 'CC', 'UNIT', 'LINE', 'SESSION'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const KEYWORD_CATEGORIES = [
  'hifu',
  'rf',
  'booster',
  'surgery',
  'lifting',
  'body',
  'toxin',
  'filler',
] as const;
export type KeywordCategory = (typeof KEYWORD_CATEGORIES)[number];

export interface KeywordEntry {
  standardName: string;
  category: KeywordCategory;
  aliases: string[];
  baseUnitType: UnitType;
}

export const KEYWORD_DICTIONARY: KeywordEntry[] = [
  // HIFU
  {
    standardName: '울쎄라',
    category: 'hifu',
    aliases: ['울세라', 'ulthera', '울쎄', '울', '울쎄라더블로'],
    baseUnitType: 'SHOT',
  },
  {
    standardName: '슈링크',
    category: 'hifu',
    aliases: ['슈링크유니버스', 'shurink', '슈', '슈링크U'],
    baseUnitType: 'SHOT',
  },
  {
    standardName: '온다리프팅',
    category: 'hifu',
    aliases: ['온다', 'onda', '온다리프팅'],
    baseUnitType: 'JOULE',
  },

  // RF
  {
    standardName: '써마지',
    category: 'rf',
    aliases: ['써마지FLX', '써마지CPT', 'thermage', '써마', '써'],
    baseUnitType: 'SHOT',
  },
  {
    standardName: '인모드',
    category: 'rf',
    aliases: ['인모드FX', '인모드FORMA', 'inmode', '인모드리프팅'],
    baseUnitType: 'SESSION',
  },
  {
    standardName: '올리지오',
    category: 'rf',
    aliases: ['올리지오X', '올리', 'oligio'],
    baseUnitType: 'SESSION',
  },
  {
    standardName: '포텐자',
    category: 'rf',
    aliases: ['포텐', 'potenza', '포텐자MRF'],
    baseUnitType: 'SESSION',
  },
  {
    standardName: '토르RF',
    category: 'rf',
    aliases: ['토르', 'TORR', 'TORR RF', '토르리프팅'],
    baseUnitType: 'SESSION',
  },

  // Booster
  {
    standardName: '쥬베룩',
    category: 'booster',
    aliases: ['쥬베룩볼륨', '쥬베', 'juvelook', '쥬베룩비타'],
    baseUnitType: 'CC',
  },
  {
    standardName: '리쥬란',
    category: 'booster',
    aliases: ['리쥬란힐러', '리쥬란HB', '리쥬', 'rejuran'],
    baseUnitType: 'CC',
  },

  // Lifting
  {
    standardName: '실리프팅',
    category: 'lifting',
    aliases: ['민트실', '실루엣소프트', '캐번실', '잼버실', '녹는실', '코그실', '실톡스'],
    baseUnitType: 'LINE',
  },

  // Surgery
  {
    standardName: '안면거상',
    category: 'surgery',
    aliases: ['미니거상', '거상술', '페이스리프트', '풀페이스리프트'],
    baseUnitType: 'SESSION',
  },
  {
    standardName: '지방흡입',
    category: 'surgery',
    aliases: ['지흡', '얼굴지흡', '이중턱지흡', '턱지흡', '바디지흡'],
    baseUnitType: 'SESSION',
  },

  // Toxin / Filler
  {
    standardName: '보톡스',
    category: 'toxin',
    aliases: ['보톡', 'botox', '보툴리눔', '제오민', '나보타', '보툴렉스'],
    baseUnitType: 'UNIT',
  },
  {
    standardName: '필러',
    category: 'filler',
    aliases: ['주름필러', '볼필러', '턱필러', '이마필러', '코필러'],
    baseUnitType: 'CC',
  },
];

/**
 * 텍스트에서 표준명을 찾는 유틸. aliases를 Contains 방식으로 검색.
 * 정확한 매칭이 필요한 경우 normalizer.ts 사용 권장.
 */
export function findStandardName(text: string): KeywordEntry | null {
  const lower = text.toLowerCase();
  for (const entry of KEYWORD_DICTIONARY) {
    if (lower.includes(entry.standardName.toLowerCase())) {
      return entry;
    }
    for (const alias of entry.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * 동음이의어 판별: "줄" → 시술 컨텍스트에 따라 JOULE 또는 LINE
 */
export function resolveAmbiguousUnit(
  text: string,
  contextKeyword: KeywordEntry | null
): UnitType | null {
  if (!contextKeyword) return null;
  return contextKeyword.baseUnitType;
}
