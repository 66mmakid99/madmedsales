/**
 * 변동 감지 모듈
 * - 이전 crawl_snapshots의 해시와 현재 텍스트 해시 비교
 * - 변동 감지 시 OCR 트리거 판단
 * - diff_summary 생성
 *
 * [설계 원칙 - 전략적 분리 (Strategic Split)]
 *
 * 1) 비용 방어 (OCR 트리거 판단):
 *    stripVolatileContent()로 날짜/이벤트 문구를 제거한 '순수 시술명+가격'
 *    해시를 비교한다. "2026년 2월"→"2026년 3월"처럼 날짜만 바뀐 경우
 *    불필요한 OCR 재실행을 방지한다.
 *
 * 2) 데이터 자산화 (황금 데이터):
 *    OCR이 실행될 때(= 실질 콘텐츠 변동 감지 시)는 원문 텍스트를
 *    그대로 보존하여 날짜, 이벤트, 할인 맥락을 hospital_pricing의
 *    raw_text + event_label + event_conditions에 기록한다.
 *    crawl_snapshots의 event_pricing_snapshot에 시계열 보존.
 *
 * v1.2 - 2026-02-21 (전략적 분리 로직 구현)
 */
import crypto from 'crypto';
import { supabase } from '../utils/supabase.js';

export interface ChangeDetectionResult {
  hasTextChanged: boolean;        // 순수 콘텐츠(stripped) 변동 여부
  hasFullTextChanged: boolean;    // 원문(날짜/이벤트 포함) 변동 여부
  hasOcrChanged: boolean;
  isFirstCrawl: boolean;
  shouldRunOcr: boolean;          // stripped 기준으로 판단 (비용 방어)
  diffSummary: string;
  previousSnapshot: CrawlSnapshotData | null;
  currentHashes: { textHash: string; strippedHash: string; ocrHash: string | null };
}

export interface CrawlSnapshotData {
  id: string;
  hospital_id: string;
  crawled_at: string;
  tier: string | null;
  pass1_text_hash: string | null;
  pass2_ocr_hash: string | null;
  equipments_found: string[];
  treatments_found: string[];
  pricing_found: unknown[];
  diff_summary: string | null;
}

/**
 * SHA-256 해시 생성
 */
export function computeHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * 휘발성(volatile) 콘텐츠를 제거하여 '순수 시술명+가격' 텍스트를 반환.
 * OCR 트리거 판단용으로만 사용. 실제 저장은 항상 원문.
 *
 * 제거 대상:
 * - 날짜: "2026년 2월", "3/31", "2026.03.01", "3월 31일"
 * - 이벤트 수식어: "이벤트", "한정", "특가", "선착순 N명", "~까지"
 * - 시간 수식어: "오늘만", "금일", "마감 임박"
 */
export function stripVolatileContent(text: string): string {
  let stripped = text;

  // 연도 패턴: "2026년", "2026."
  stripped = stripped.replace(/\d{4}년\s*/g, '');
  stripped = stripped.replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, '');

  // 월일 패턴: "2월", "3월 31일", "3/31"
  stripped = stripped.replace(/\d{1,2}월\s*\d{1,2}일/g, '');
  stripped = stripped.replace(/\d{1,2}월/g, '');
  stripped = stripped.replace(/\d{1,2}[./]\d{1,2}/g, '');

  // 날짜 범위: "~3/31까지", "~4/30까지"
  stripped = stripped.replace(/[~\-–]\s*\d{1,2}[./]\d{1,2}\s*까지/g, '');
  stripped = stripped.replace(/[~\-–]\s*\d{1,2}\s*까지/g, '');
  // 잔여 물결표/까지
  stripped = stripped.replace(/[~\-–]\s*까지/g, '');
  stripped = stripped.replace(/까지/g, '');

  // 이벤트 수식어
  stripped = stripped.replace(/이벤트|한정|특가|프로모션|할인가|세일|체험가/g, '');
  stripped = stripped.replace(/선착순\s*\d+\s*명/g, '');
  stripped = stripped.replace(/\d+\s*명\s*한정/g, '');
  stripped = stripped.replace(/오픈\s*기념|개원\s*기념|\d+주년\s*기념/g, '');
  stripped = stripped.replace(/얼리버드|런칭|파격|초특가/g, '');
  stripped = stripped.replace(/\d+\s*%\s*(?:할인|OFF|off|세일)/gi, '');

  // 긴급성
  stripped = stripped.replace(/마감\s*임박|오늘만|금일\s*한정|기간\s*한정/g, '');

  // 연속 공백 정리
  stripped = stripped.replace(/\s+/g, ' ').trim();

  return stripped;
}

/**
 * 병원의 가장 최근 스냅샷을 조회
 */
async function getLatestSnapshot(hospitalId: string): Promise<CrawlSnapshotData | null> {
  const { data } = await supabase
    .from('crawl_snapshots')
    .select('*')
    .eq('hospital_id', hospitalId)
    .order('crawled_at', { ascending: false })
    .limit(1)
    .single();

  return data as CrawlSnapshotData | null;
}

/**
 * 장비/시술 변동 diff 생성
 */
function buildDiffSummary(
  prevEquipments: string[],
  currentEquipments: string[],
  prevTreatments: string[],
  currentTreatments: string[]
): string {
  const parts: string[] = [];

  const prevEqSet = new Set(prevEquipments.map((e) => e.toLowerCase()));
  const currEqSet = new Set(currentEquipments.map((e) => e.toLowerCase()));

  const addedEq = currentEquipments.filter((e) => !prevEqSet.has(e.toLowerCase()));
  const removedEq = prevEquipments.filter((e) => !currEqSet.has(e.toLowerCase()));

  if (addedEq.length > 0) parts.push(`장비 추가: ${addedEq.join(', ')}`);
  if (removedEq.length > 0) parts.push(`장비 제거: ${removedEq.join(', ')}`);

  const prevTrSet = new Set(prevTreatments.map((t) => t.toLowerCase()));
  const currTrSet = new Set(currentTreatments.map((t) => t.toLowerCase()));

  const addedTr = currentTreatments.filter((t) => !prevTrSet.has(t.toLowerCase()));
  const removedTr = prevTreatments.filter((t) => !currTrSet.has(t.toLowerCase()));

  if (addedTr.length > 0) parts.push(`시술 추가: ${addedTr.join(', ')}`);
  if (removedTr.length > 0) parts.push(`시술 제거: ${removedTr.join(', ')}`);

  if (parts.length === 0) return '변동 없음';
  return parts.join(' | ');
}

/**
 * 텍스트 해시 비교하여 변동 감지.
 *
 * 전략적 분리:
 * - strippedHash: 날짜/이벤트 문구 제거 → OCR 트리거 판단 (비용 방어)
 * - textHash: 원문 그대로 → 스냅샷 저장 및 시계열 추적 (데이터 자산화)
 *
 * shouldRunOcr = strippedHash 변동 시에만 true
 * → 날짜만 바뀌어도 OCR이 도는 낭비를 방지
 * → 시술명/가격이 실제 변하면 OCR 실행하여 전체 맥락 수집
 */
export async function detectChanges(
  hospitalId: string,
  currentText: string,
  currentOcrText: string | null = null,
  currentEquipments: string[] = [],
  currentTreatments: string[] = []
): Promise<ChangeDetectionResult> {
  const textHash = computeHash(currentText);
  const strippedHash = computeHash(stripVolatileContent(currentText));
  const ocrHash = currentOcrText ? computeHash(currentOcrText) : null;

  const previousSnapshot = await getLatestSnapshot(hospitalId);

  // 최초 크롤링
  if (!previousSnapshot) {
    return {
      hasTextChanged: true,
      hasFullTextChanged: true,
      hasOcrChanged: true,
      isFirstCrawl: true,
      shouldRunOcr: true,
      diffSummary: '최초 크롤링',
      previousSnapshot: null,
      currentHashes: { textHash, strippedHash, ocrHash },
    };
  }

  // 비용 방어: stripped 해시로 실질 콘텐츠 변동 판단
  const hasTextChanged = previousSnapshot.pass1_text_hash !== strippedHash;
  // 데이터 자산화: 원문 해시로 전체 변동 감지 (로깅/추적용)
  const hasFullTextChanged = previousSnapshot.pass2_ocr_hash !== textHash;
  const hasOcrChanged = ocrHash !== null && previousSnapshot.pass2_ocr_hash !== ocrHash;

  const diffSummary = hasTextChanged
    ? buildDiffSummary(
        previousSnapshot.equipments_found ?? [],
        currentEquipments,
        previousSnapshot.treatments_found ?? [],
        currentTreatments
      )
    : '텍스트 변동 없음';

  return {
    hasTextChanged,
    hasFullTextChanged,
    hasOcrChanged,
    isFirstCrawl: false,
    shouldRunOcr: hasTextChanged, // stripped 기준 → 실질 콘텐츠 변동 시만 OCR
    diffSummary,
    previousSnapshot,
    currentHashes: { textHash, strippedHash, ocrHash },
  };
}

// ─── B-1: 장비/시술 변동 추출 및 equipment_changes 기록 ────

export interface EquipmentChange {
  id?: string;
  hospital_id: string;
  change_type: 'ADDED' | 'REMOVED';
  item_type: 'EQUIPMENT' | 'TREATMENT';
  item_name: string;
  standard_name: string;
  detected_at: string;
  prev_snapshot_id: string | null;
  curr_snapshot_id: string | null;
}

/**
 * 이전/현재 스냅샷을 비교하여 장비·시술 변동을 추출하고 equipment_changes에 INSERT.
 *
 * - lowercase 비교로 "써마지 FLX" ↔ "써마지 flx" 차이 무시
 * - 표준명(standard_name)은 첫 매칭 기준 원본 사용
 * - DB INSERT 실패 시 skip (non-fatal)
 */
export async function detectEquipmentChanges(
  hospitalId: string,
  prevSnapshot: CrawlSnapshotData | null,
  currEquipments: string[],
  currTreatments: string[],
  currSnapshotId: string | null = null
): Promise<EquipmentChange[]> {
  const changes: EquipmentChange[] = [];
  const now = new Date().toISOString();
  const prevSnapshotId = prevSnapshot?.id ?? null;

  const prevEquipSet = new Set((prevSnapshot?.equipments_found ?? []).map((e) => e.toLowerCase()));
  const currEquipSet = new Set(currEquipments.map((e) => e.toLowerCase()));

  // 장비 추가
  for (const eq of currEquipments) {
    if (!prevEquipSet.has(eq.toLowerCase())) {
      changes.push({
        hospital_id: hospitalId,
        change_type: 'ADDED',
        item_type: 'EQUIPMENT',
        item_name: eq,
        standard_name: eq,
        detected_at: now,
        prev_snapshot_id: prevSnapshotId,
        curr_snapshot_id: currSnapshotId,
      });
    }
  }

  // 장비 제거
  for (const eq of (prevSnapshot?.equipments_found ?? [])) {
    if (!currEquipSet.has(eq.toLowerCase())) {
      changes.push({
        hospital_id: hospitalId,
        change_type: 'REMOVED',
        item_type: 'EQUIPMENT',
        item_name: eq,
        standard_name: eq,
        detected_at: now,
        prev_snapshot_id: prevSnapshotId,
        curr_snapshot_id: currSnapshotId,
      });
    }
  }

  const prevTreatSet = new Set((prevSnapshot?.treatments_found ?? []).map((t) => t.toLowerCase()));
  const currTreatSet = new Set(currTreatments.map((t) => t.toLowerCase()));

  // 시술 추가
  for (const tr of currTreatments) {
    if (!prevTreatSet.has(tr.toLowerCase())) {
      changes.push({
        hospital_id: hospitalId,
        change_type: 'ADDED',
        item_type: 'TREATMENT',
        item_name: tr,
        standard_name: tr,
        detected_at: now,
        prev_snapshot_id: prevSnapshotId,
        curr_snapshot_id: currSnapshotId,
      });
    }
  }

  // 시술 제거
  for (const tr of (prevSnapshot?.treatments_found ?? [])) {
    if (!currTreatSet.has(tr.toLowerCase())) {
      changes.push({
        hospital_id: hospitalId,
        change_type: 'REMOVED',
        item_type: 'TREATMENT',
        item_name: tr,
        standard_name: tr,
        detected_at: now,
        prev_snapshot_id: prevSnapshotId,
        curr_snapshot_id: currSnapshotId,
      });
    }
  }

  // DB에 INSERT (best-effort)
  if (changes.length > 0) {
    try {
      const { data } = await supabase
        .from('equipment_changes')
        .insert(changes.map((c) => ({
          hospital_id: c.hospital_id,
          change_type: c.change_type,
          item_type: c.item_type,
          item_name: c.item_name,
          standard_name: c.standard_name,
          detected_at: c.detected_at,
          prev_snapshot_id: c.prev_snapshot_id,
          curr_snapshot_id: c.curr_snapshot_id,
        })))
        .select('id');

      // id 할당
      if (data) {
        for (let i = 0; i < data.length && i < changes.length; i++) {
          changes[i].id = (data[i] as { id: string }).id;
        }
      }
    } catch {
      // DB INSERT 실패 → skip (non-fatal)
    }
  }

  return changes;
}

/**
 * 크롤링 스냅샷을 DB에 저장
 */
export async function saveSnapshot(
  hospitalId: string,
  data: {
    tier: string | null;
    textHash: string;
    ocrHash: string | null;
    equipmentsFound: string[];
    treatmentsFound: string[];
    pricingFound: unknown[];
    eventPricingSnapshot: unknown[];  // 이벤트 컨텍스트 포함 가격 스냅샷
    newCompounds: string[];
    diffSummary: string;
  }
): Promise<void> {
  await supabase.from('crawl_snapshots').insert({
    hospital_id: hospitalId,
    tier: data.tier,
    pass1_text_hash: data.textHash,
    pass2_ocr_hash: data.ocrHash,
    equipments_found: data.equipmentsFound,
    treatments_found: data.treatmentsFound,
    pricing_found: data.pricingFound,
    event_pricing_snapshot: data.eventPricingSnapshot,
    new_compounds: data.newCompounds,
    diff_summary: data.diffSummary,
    crawled_at: new Date().toISOString(),
  });
}
