/**
 * Stage 3: 합성어 분해 모듈
 * - compound_words 사전 조회 → 즉시 분해
 * - Regex 패턴 감지
 * - 사전에 없는 새 합성어 → compound_word_candidates 후보 등록
 *
 * [Fallback 설계]
 * DB 연결 실패/API 키 없음 등 예외 시:
 * - TS 사전 매칭은 항상 동작 (오프라인)
 * - DB 조회 실패 → skip (non-fatal)
 * - 후보 등록 실패 → skip (non-fatal)
 * → 파이프라인이 중단되지 않고 안전하게 다음 Stage로 진행
 *
 * v1.1 - 2026-02-21 (API fallback 보강)
 */
import {
  COMPOUND_WORDS,
  decomposeCompoundWord,
  type CompoundWordEntry,
} from '../../packages/shared/src/constants/compound-words.js';
import { supabase } from '../utils/supabase.js';

export interface DecompositionResult {
  original: string;
  decomposed: string[] | null;
  source: 'dictionary' | 'db' | 'regex_candidate' | null;
  confidence: number;
  scoringNote: string | null;
}

export interface DecomposerOutput {
  results: DecompositionResult[];
  newCandidates: string[];
}

/**
 * 합성어 감지 Regex 패턴.
 * 한국어 미용 시술 합성어는 보통 두 시술명의 앞 1~2음절을 결합.
 * 예: 울(쎄라) + 써(마지) = 울써마지
 */
const COMPOUND_PREFIX_PATTERN = /^(울|써|인|슈|텐|올|포|쥬|리|실|보)(써|쥬|리|슈|모|포|텐|올|인)/;

/**
 * DB에서 확정 합성어를 조회 (TS 상수에 없는 경우 대비).
 * DB 연결 실패 시 null 반환 (non-fatal).
 */
async function lookupDbCompoundWord(text: string): Promise<CompoundWordEntry | null> {
  try {
    const { data, error } = await supabase
      .from('compound_words')
      .select('compound_name, decomposed_names, scoring_note')
      .eq('is_active', true)
      .ilike('compound_name', `%${text}%`)
      .limit(1)
      .single();

    if (error || !data) return null;

    return {
      compoundName: data.compound_name,
      decomposedNames: data.decomposed_names as string[],
      scoringNote: data.scoring_note ?? '',
    };
  } catch {
    // DB 연결 실패 → skip (TS 사전 fallback으로 충분)
    return null;
  }
}

/**
 * DB에서 기존 후보가 있는지 확인하고, 있으면 discovery_count 증가.
 * DB 연결 실패 시 무시 (non-fatal). 후보 등록은 최선 노력(best-effort).
 */
async function upsertCandidate(
  rawText: string,
  hospitalId: string | null
): Promise<void> {
  try {
    // 기존 후보 확인
    const { data: existing } = await supabase
      .from('compound_word_candidates')
      .select('id, discovery_count')
      .eq('raw_text', rawText)
      .limit(1)
      .single();

    if (existing) {
      // discovery_count 증가
      await supabase
        .from('compound_word_candidates')
        .update({ discovery_count: existing.discovery_count + 1 })
        .eq('id', existing.id);
    } else {
      // 새 후보 등록
      await supabase.from('compound_word_candidates').insert({
        raw_text: rawText,
        inferred_decomposition: null, // Gemini 추론은 별도 배치에서
        confidence: 0,
        discovery_count: 1,
        first_hospital_id: hospitalId,
        status: 'pending',
      });
    }
  } catch {
    // DB 연결 실패 → 후보 등록 skip (파이프라인 중단 방지)
  }
}

/**
 * 단일 텍스트를 합성어 분해 시도
 */
export async function decomposeSingle(
  text: string,
  hospitalId: string | null = null
): Promise<DecompositionResult> {
  const trimmed = text.trim();

  // 1. TS 상수 사전 조회
  const dictMatch = decomposeCompoundWord(trimmed);
  if (dictMatch) {
    return {
      original: trimmed,
      decomposed: dictMatch.decomposedNames,
      source: 'dictionary',
      confidence: 1.0,
      scoringNote: dictMatch.scoringNote,
    };
  }

  // 2. DB 사전 조회 (런타임 추가분)
  const dbMatch = await lookupDbCompoundWord(trimmed);
  if (dbMatch) {
    return {
      original: trimmed,
      decomposed: dbMatch.decomposedNames,
      source: 'db',
      confidence: 1.0,
      scoringNote: dbMatch.scoringNote,
    };
  }

  // 3. Regex 패턴 감지 → 후보 등록
  if (COMPOUND_PREFIX_PATTERN.test(trimmed)) {
    await upsertCandidate(trimmed, hospitalId);
    return {
      original: trimmed,
      decomposed: null,
      source: 'regex_candidate',
      confidence: 0,
      scoringNote: null,
    };
  }

  // 4. 매칭 안 됨
  return {
    original: trimmed,
    decomposed: null,
    source: null,
    confidence: 0,
    scoringNote: null,
  };
}

/**
 * 여러 텍스트를 일괄 합성어 분해.
 * normalizer의 unmatched 항목 + 원문 텍스트에서 추출된 항목을 입력.
 */
export async function decomposeAll(
  items: string[],
  hospitalId: string | null = null
): Promise<DecomposerOutput> {
  const results: DecompositionResult[] = [];
  const newCandidates: string[] = [];

  for (const item of items) {
    if (!item.trim()) continue;
    const result = await decomposeSingle(item, hospitalId);
    results.push(result);
    if (result.source === 'regex_candidate') {
      newCandidates.push(item);
    }
  }

  return { results, newCandidates };
}
