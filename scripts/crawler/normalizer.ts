/**
 * Stage 2: 정규화 모듈
 * - OCR 오인식 보정
 * - keyword_dictionary aliases 기반 Contains 매칭
 * - 미매칭 키워드 수집 (매칭률 모니터링용)
 *
 * v1.0 - 2026-02-21
 */
import {
  KEYWORD_DICTIONARY,
  type KeywordEntry,
} from '../../packages/shared/src/constants/keyword-dictionary.js';

export interface NormalizedItem {
  original: string;
  standardName: string | null;
  category: string | null;
  baseUnitType: string | null;
  matchedBy: 'standard' | 'alias' | null;
}

export interface NormalizerResult {
  normalized: NormalizedItem[];
  unmatched: string[];
  matchRate: number;
}

/** OCR 오인식 보정 맵 */
const OCR_CORRECTIONS: Record<string, string> = {
  숏: '샷',
  숫: '샷',
  쇼트: '샷',
  줄: '줄', // 동음이의어 — 컨텍스트로 판별 (JOULE vs LINE)
  '0원': '0원',
};

/** OCR 오인식 패턴 보정 (0↔O, 1↔l|I 등) */
const OCR_CHAR_FIXES: [RegExp, string][] = [
  [/[０-９]/g, (match: string) => String.fromCharCode(match.charCodeAt(0) - 0xFF10 + 0x30)], // fullwidth → ascii
];

/**
 * OCR 텍스트의 일반적 오류를 보정
 */
export function correctOcrErrors(text: string): string {
  let result = text;

  // 전각 → 반각 숫자
  for (const [pattern, replacement] of OCR_CHAR_FIXES) {
    result = result.replace(pattern, replacement as string);
  }

  // 단어 단위 보정
  for (const [wrong, correct] of Object.entries(OCR_CORRECTIONS)) {
    if (wrong !== correct) {
      result = result.replaceAll(wrong, correct);
    }
  }

  return result;
}

/**
 * 단일 텍스트를 keyword_dictionary에서 매칭하여 표준명 반환
 */
export function normalizeKeyword(text: string): NormalizedItem {
  const corrected = correctOcrErrors(text.trim());
  const lower = corrected.toLowerCase();

  // 1. 표준명 직접 매칭
  for (const entry of KEYWORD_DICTIONARY) {
    if (lower.includes(entry.standardName.toLowerCase())) {
      return {
        original: text,
        standardName: entry.standardName,
        category: entry.category,
        baseUnitType: entry.baseUnitType,
        matchedBy: 'standard',
      };
    }
  }

  // 2. Aliases 매칭 (긴 alias부터 매칭하여 정확도 향상)
  const sortedEntries = KEYWORD_DICTIONARY.map((entry) => ({
    entry,
    sortedAliases: [...entry.aliases].sort((a, b) => b.length - a.length),
  }));

  for (const { entry, sortedAliases } of sortedEntries) {
    for (const alias of sortedAliases) {
      if (lower.includes(alias.toLowerCase())) {
        return {
          original: text,
          standardName: entry.standardName,
          category: entry.category,
          baseUnitType: entry.baseUnitType,
          matchedBy: 'alias',
        };
      }
    }
  }

  return {
    original: text,
    standardName: null,
    category: null,
    baseUnitType: null,
    matchedBy: null,
  };
}

/**
 * 여러 텍스트 항목을 일괄 정규화
 */
export function normalizeAll(items: string[]): NormalizerResult {
  const normalized: NormalizedItem[] = [];
  const unmatched: string[] = [];

  for (const item of items) {
    if (!item.trim()) continue;
    const result = normalizeKeyword(item);
    normalized.push(result);
    if (!result.standardName) {
      unmatched.push(item);
    }
  }

  const total = normalized.length;
  const matched = total - unmatched.length;
  const matchRate = total > 0 ? matched / total : 0;

  return { normalized, unmatched, matchRate };
}

/**
 * 장비/시술 목록에서 텍스트를 추출하여 정규화.
 * Gemini 분석 결과의 equipment_name, treatment_name에 적용.
 */
export function normalizeEquipmentNames(names: string[]): NormalizerResult {
  return normalizeAll(names);
}

export function normalizeTreatmentNames(names: string[]): NormalizerResult {
  return normalizeAll(names);
}

/**
 * 전체 텍스트에서 알려진 키워드를 모두 추출 (중복 제거).
 * 크롤링 원문 텍스트에서 장비/시술 키워드를 스캔하는 용도.
 */
export function extractKnownKeywords(fullText: string): KeywordEntry[] {
  const corrected = correctOcrErrors(fullText);
  const lower = corrected.toLowerCase();
  const found: KeywordEntry[] = [];
  const seen = new Set<string>();

  for (const entry of KEYWORD_DICTIONARY) {
    if (seen.has(entry.standardName)) continue;

    // 표준명 매칭
    if (lower.includes(entry.standardName.toLowerCase())) {
      found.push(entry);
      seen.add(entry.standardName);
      continue;
    }

    // Alias 매칭
    for (const alias of entry.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        found.push(entry);
        seen.add(entry.standardName);
        break;
      }
    }
  }

  return found;
}
