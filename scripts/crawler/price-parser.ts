/**
 * Stage 4: 가격 파싱 모듈
 * - Regex로 [시술명]+[수량]+[단위]+[가격] 세트 추출
 * - 동음이의어 판별 (줄 → JOULE vs LINE)
 * - unit_price = total_price / total_quantity
 * - 이벤트 컨텍스트 정밀 추출 (황금 데이터)
 * - hospital_pricing INSERT 데이터 생성
 *
 * v1.1 - 2026-02-21 (이벤트 황금 데이터 전략 적용)
 */
import {
  KEYWORD_DICTIONARY,
  type KeywordEntry,
} from '../../packages/shared/src/constants/keyword-dictionary.js';
import { normalizeKeyword } from './normalizer.js';

export interface EventContext {
  label: string | null;           // "3월 한정", "오픈 기념", "선착순 10명"
  startDate: string | null;       // ISO date (파싱 가능 시)
  endDate: string | null;         // ISO date (파싱 가능 시)
  conditions: EventConditions;    // 구조화된 이벤트 조건
}

export interface EventConditions {
  limit: string | null;           // "선착순 10명", "100명 한정"
  duration: string | null;        // "3월 한정", "2월 28일까지"
  urgency: string | null;         // "마감 임박", "오늘만", "금일 한정"
  occasion: string | null;        // "오픈 기념", "1주년", "신규 오픈"
  discount: string | null;        // "50% 할인", "30% OFF"
}

export interface ParsedPrice {
  treatmentName: string;
  standardName: string | null;
  rawText: string;
  totalQuantity: number | null;
  unitType: string | null;
  totalPrice: number;
  unitPrice: number | null;
  priceBand: 'Premium' | 'Mid' | 'Mass';
  isPackage: boolean;
  isEventPrice: boolean;
  isOutlier: boolean;
  confidenceLevel: 'EXACT' | 'CALCULATED' | 'ESTIMATED';
  eventContext: EventContext;      // 이벤트 컨텍스트 (황금 데이터)
}

export interface PriceParserResult {
  prices: ParsedPrice[];
  unparsed: string[];
}

/** 한국어 숫자 변환: "5만" → 50000, "350,000" → 350000, "1천" → 1000 */
export function parseKoreanNumber(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(/,/g, '');

  // "5만" | "15만" | "150만" 패턴
  const manMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*만$/);
  if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);

  // "5천" | "15천" 패턴
  const cheonMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*천$/);
  if (cheonMatch) return Math.round(parseFloat(cheonMatch[1]) * 1000);

  // "만5천" → 15000
  const manCheonMatch = cleaned.match(/^(\d+)만(\d+)천?$/);
  if (manCheonMatch) {
    return parseInt(manCheonMatch[1], 10) * 10000 + parseInt(manCheonMatch[2], 10) * 1000;
  }

  // 순수 숫자
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/** 단위 텍스트를 표준 UnitType으로 변환 */
const UNIT_MAP: Record<string, string> = {
  샷: 'SHOT', shot: 'SHOT', shots: 'SHOT',
  cc: 'CC', ml: 'CC', 시시: 'CC',
  유닛: 'UNIT', u: 'UNIT', unit: 'UNIT', units: 'UNIT',
  줄: '__AMBIGUOUS__', // 동음이의어 — 컨텍스트로 판별
  j: 'JOULE', joule: 'JOULE',
  라인: 'LINE', line: 'LINE', 가닥: 'LINE',
  회: 'SESSION', 패키지: 'SESSION', 세션: 'SESSION', session: 'SESSION',
};

/**
 * 동음이의어 "줄" 판별.
 * 시술명 컨텍스트에서 keyword_dictionary의 base_unit_type을 참조.
 * - 온다계열 → JOULE
 * - 실계열 → LINE
 * - 모호하면 LINE (더 일반적)
 */
function resolveAmbiguousJul(contextText: string): string {
  const lower = contextText.toLowerCase();

  // JOULE 계열 키워드
  const jouleKeywords = ['온다', 'onda', '줄리프팅', '하이푸'];
  for (const kw of jouleKeywords) {
    if (lower.includes(kw)) return 'JOULE';
  }

  // LINE 계열 키워드
  const lineKeywords = ['실', '민트', '코그', '실루엣', '캐번', '잼버', '녹는실'];
  for (const kw of lineKeywords) {
    if (lower.includes(kw)) return 'LINE';
  }

  // keyword_dictionary에서 base_unit_type 조회
  for (const entry of KEYWORD_DICTIONARY) {
    const allNames = [entry.standardName, ...entry.aliases];
    for (const name of allNames) {
      if (lower.includes(name.toLowerCase())) {
        if (entry.baseUnitType === 'JOULE') return 'JOULE';
        if (entry.baseUnitType === 'LINE') return 'LINE';
      }
    }
  }

  return 'LINE'; // 기본값: LINE이 더 일반적
}

function resolveUnit(unitText: string, contextText: string): string | null {
  const lower = unitText.toLowerCase().trim();
  const mapped = UNIT_MAP[lower];
  if (!mapped) return null;
  if (mapped === '__AMBIGUOUS__') return resolveAmbiguousJul(contextText);
  return mapped;
}

/** 이벤트/체험가 감지 키워드 (확장) */
const EVENT_KEYWORDS = [
  '체험가', '이벤트가', '이벤트', '1회체험', '체험', '프로모션', '할인가', '특가',
  '한정', '기념', '오픈', '할인', '세일', '선착순', '마감', '임박', '금일',
  '오늘만', '기간한정', '얼리버드', '런칭', '파격', 'SALE', 'EVENT', 'OFF',
];

/** 이벤트 라벨 추출 패턴 */
const EVENT_LABEL_PATTERNS: RegExp[] = [
  // "3월 한정", "12월 이벤트", "2월 28일까지"
  /(\d{1,2}월\s*(?:한정|이벤트|특가|프로모션|할인|세일))/gi,
  /(\d{1,2}월\s*\d{1,2}일\s*(?:까지|한정|마감))/gi,
  // "선착순 10명", "100명 한정"
  /(선착순\s*\d+\s*명)/gi,
  /(\d+\s*명\s*한정)/gi,
  // "오픈 기념", "1주년 기념", "신규 오픈"
  /((?:오픈|개원|리뉴얼|\d+주년)\s*기념)/gi,
  /(신규\s*오픈)/gi,
  // "마감 임박", "오늘만", "금일 한정", "기간한정"
  /(마감\s*임박)/gi,
  /(오늘만|금일\s*한정|기간\s*한정)/gi,
  // "50% 할인", "30% OFF"
  /(\d+\s*%\s*(?:할인|OFF|off|세일))/gi,
  // "얼리버드", "런칭 특가"
  /(얼리버드\s*(?:특가|할인|가격)?)/gi,
  /(런칭\s*(?:특가|할인|가격)?)/gi,
  // "파격가", "초특가"
  /(파격\s*(?:가|할인|특가))/gi,
  /(초특가)/gi,
];

/** 이벤트 날짜 추출 */
const DATE_RANGE_PATTERNS: RegExp[] = [
  // "2026.3.1 ~ 2026.3.31", "3/1~3/31"
  /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*[~\-–]\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g,
  /(\d{1,2})[./](\d{1,2})\s*[~\-–]\s*(\d{1,2})[./](\d{1,2})/g,
  // "3월 1일 ~ 3월 31일", "3월 31일까지"
  /(\d{1,2})월\s*(\d{1,2})일\s*[~\-–]\s*(\d{1,2})월\s*(\d{1,2})일/g,
  /(\d{1,2})월\s*(\d{1,2})일\s*까지/g,
  // "3월 한정", "3월말까지"
  /(\d{1,2})월\s*(?:한정|말\s*까지|까지)/g,
];

/**
 * 주변 텍스트(±100자)에서 이벤트 컨텍스트를 정밀 추출.
 * 이벤트 데이터는 '황금 데이터'로, 최대한 보존한다.
 */
function extractEventContext(fullText: string, matchIndex: number, matchLength: number): EventContext {
  const windowStart = Math.max(0, matchIndex - 100);
  const windowEnd = Math.min(fullText.length, matchIndex + matchLength + 100);
  const window = fullText.substring(windowStart, windowEnd);

  const labels: string[] = [];
  const conditions: EventConditions = {
    limit: null, duration: null, urgency: null, occasion: null, discount: null,
  };

  for (const pattern of EVENT_LABEL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(window)) !== null) {
      labels.push(m[1].trim());
    }
  }

  // 조건별 분류
  const windowLower = window.toLowerCase();

  // limit: 선착순/인원 제한
  const limitMatch = window.match(/(선착순\s*\d+\s*명|\d+\s*명\s*한정)/);
  if (limitMatch) conditions.limit = limitMatch[1].trim();

  // duration: 기간 한정
  const durationMatch = window.match(/(\d{1,2}월\s*(?:한정|말\s*까지|까지)|\d{1,2}월\s*\d{1,2}일\s*까지|기간\s*한정)/);
  if (durationMatch) conditions.duration = durationMatch[1].trim();

  // urgency: 긴급성
  const urgencyMatch = window.match(/(마감\s*임박|오늘만|금일\s*한정|오늘\s*마감|마지막\s*기회)/);
  if (urgencyMatch) conditions.urgency = urgencyMatch[1].trim();

  // occasion: 계기
  const occasionMatch = window.match(/((?:오픈|개원|리뉴얼|\d+주년)\s*기념|신규\s*오픈|런칭)/);
  if (occasionMatch) conditions.occasion = occasionMatch[1].trim();

  // discount: 할인율
  const discountMatch = window.match(/(\d+\s*%\s*(?:할인|OFF|off|세일))/i);
  if (discountMatch) conditions.discount = discountMatch[1].trim();

  // 날짜 추출
  let startDate: string | null = null;
  let endDate: string | null = null;
  const currentYear = new Date().getFullYear();

  // "N월 N일까지" 패턴
  const untilMatch = window.match(/(\d{1,2})월\s*(\d{1,2})일\s*까지/);
  if (untilMatch) {
    const month = parseInt(untilMatch[1], 10);
    const day = parseInt(untilMatch[2], 10);
    endDate = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // "N월 한정" → 해당 월 말일
  const monthLimitMatch = window.match(/(\d{1,2})월\s*(?:한정|말\s*까지)/);
  if (monthLimitMatch && !endDate) {
    const month = parseInt(monthLimitMatch[1], 10);
    const lastDay = new Date(currentYear, month, 0).getDate();
    endDate = `${currentYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  const label = labels.length > 0 ? labels.join(', ') : null;

  return { label, startDate, endDate, conditions };
}

/** 이벤트 여부 판정 (키워드 기반 + 컨텍스트) */
function detectEventPrice(
  fullText: string,
  matchIndex: number,
  matchLength: number
): { isEvent: boolean; context: EventContext } {
  const windowStart = Math.max(0, matchIndex - 50);
  const windowEnd = Math.min(fullText.length, matchIndex + matchLength + 50);
  const window = fullText.substring(windowStart, windowEnd);

  const isEvent = EVENT_KEYWORDS.some((kw) => window.toLowerCase().includes(kw.toLowerCase()));
  const context = extractEventContext(fullText, matchIndex, matchLength);

  // 이벤트 라벨이나 조건이 있으면 isEvent도 true로 강화
  const hasContext = context.label !== null
    || context.conditions.limit !== null
    || context.conditions.urgency !== null
    || context.conditions.occasion !== null
    || context.conditions.discount !== null;

  return { isEvent: isEvent || hasContext, context };
}

/** 가격대 분류 */
function classifyPriceBand(unitPrice: number | null, totalPrice: number): 'Premium' | 'Mid' | 'Mass' {
  const price = unitPrice ?? totalPrice;
  if (price >= 500000) return 'Premium';
  if (price >= 200000) return 'Mid';
  return 'Mass';
}

/** 이상치 감지 */
function isOutlierPrice(totalPrice: number, unitPrice: number | null): boolean {
  // 시술 단가가 100원 미만이거나 1000만원 초과이면 이상치
  if (unitPrice !== null) {
    if (unitPrice < 100 || unitPrice > 10000000) return true;
  }
  // 총액이 1억 초과이면 이상치
  if (totalPrice > 100000000) return true;
  return false;
}

/**
 * 가격 패턴 추출 Regex.
 *
 * 패턴: [시술명] [수량][단위] [가격]원
 * 예: "울쎄라 300샷 1,500,000원"
 *     "온다 5만줄 35만원"
 *     "써마지 900샷 150만원"
 *     "실리프팅 10줄 50만원"
 */
const PRICE_LINE_PATTERN =
  /([가-힣a-zA-Z\s]+?)\s*(\d+(?:,\d{3})*(?:\.\d+)?(?:만|천)?)\s*(샷|shot|shots|cc|ml|시시|유닛|u|unit|units|줄|j|joule|라인|line|가닥|회|패키지|세션|session)\s*[^\d]*?(\d+(?:,\d{3})*(?:\.\d+)?(?:만|천)?)\s*원/gi;

/**
 * 단순 [시술명] [가격]원 패턴 (수량/단위 없음 → SESSION)
 */
const SIMPLE_PRICE_PATTERN =
  /([가-힣a-zA-Z]{2,15})\s+(\d+(?:,\d{3})*(?:\.\d+)?(?:만|천)?)\s*원/gi;

/**
 * 원문 텍스트에서 가격 정보를 파싱
 */
export function parsePrices(text: string): PriceParserResult {
  const prices: ParsedPrice[] = [];
  const seen = new Set<string>();
  const unparsed: string[] = [];

  // 1. 수량+단위+가격 패턴 (EXACT)
  let match: RegExpExecArray | null;
  const fullPattern = new RegExp(PRICE_LINE_PATTERN.source, 'gi');

  while ((match = fullPattern.exec(text)) !== null) {
    const treatmentName = match[1].trim();
    const quantityStr = match[2];
    const unitStr = match[3];
    const priceStr = match[4];

    const totalQuantity = parseKoreanNumber(quantityStr);
    const totalPrice = parseKoreanNumber(priceStr);
    if (!totalPrice || totalPrice <= 0) continue;

    const unitType = resolveUnit(unitStr, treatmentName);
    const unitPrice = totalQuantity && totalQuantity > 0
      ? Math.round((totalPrice / totalQuantity) * 100) / 100
      : null;

    const norm = normalizeKeyword(treatmentName);
    const { isEvent, context } = detectEventPrice(text, match.index, match[0].length);

    const key = `${norm.standardName ?? treatmentName}-${totalPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);

    prices.push({
      treatmentName,
      standardName: norm.standardName,
      rawText: match[0],
      totalQuantity,
      unitType,
      totalPrice,
      unitPrice,
      priceBand: classifyPriceBand(unitPrice, totalPrice),
      isPackage: treatmentName.includes('패키지') || treatmentName.includes('세트'),
      isEventPrice: isEvent,
      isOutlier: isOutlierPrice(totalPrice, unitPrice),
      confidenceLevel: 'EXACT',
      eventContext: context,
    });
  }

  // 2. 단순 시술명+가격 패턴 (수량 없음 → CALCULATED or ESTIMATED)
  const simplePattern = new RegExp(SIMPLE_PRICE_PATTERN.source, 'gi');

  while ((match = simplePattern.exec(text)) !== null) {
    const treatmentName = match[1].trim();
    const priceStr = match[2];
    const totalPrice = parseKoreanNumber(priceStr);
    if (!totalPrice || totalPrice <= 0) continue;

    // 일반적이지 않은 텍스트 필터
    if (treatmentName.length < 2 || treatmentName.length > 15) continue;
    if (/^\d+$/.test(treatmentName)) continue;

    const norm = normalizeKeyword(treatmentName);
    const key = `${norm.standardName ?? treatmentName}-${totalPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { isEvent, context } = detectEventPrice(text, match.index, match[0].length);

    prices.push({
      treatmentName,
      standardName: norm.standardName,
      rawText: match[0],
      totalQuantity: null,
      unitType: norm.baseUnitType ?? 'SESSION',
      totalPrice,
      unitPrice: null,
      priceBand: classifyPriceBand(null, totalPrice),
      isPackage: false,
      isEventPrice: isEvent,
      isOutlier: isOutlierPrice(totalPrice, null),
      confidenceLevel: 'ESTIMATED',
      eventContext: context,
    });
  }

  return { prices, unparsed };
}

/**
 * ParsedPrice를 hospital_pricing INSERT 데이터로 변환
 */
export function toHospitalPricingRow(
  parsed: ParsedPrice,
  hospitalId: string
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    hospital_id: hospitalId,
    treatment_name: parsed.treatmentName,
    standard_name: parsed.standardName,
    raw_text: parsed.rawText,
    total_quantity: parsed.totalQuantity,
    unit_type: parsed.unitType,
    total_price: parsed.totalPrice,
    unit_price: parsed.unitPrice,
    price_band: parsed.priceBand,
    is_package: parsed.isPackage,
    is_event_price: parsed.isEventPrice,
    is_outlier: parsed.isOutlier,
    confidence_level: parsed.confidenceLevel,
    event_label: parsed.eventContext.label,
    event_start_date: parsed.eventContext.startDate,
    event_end_date: parsed.eventContext.endDate,
    event_conditions: parsed.eventContext.conditions,
    event_detected_at: parsed.isEventPrice ? now : null,
    crawled_at: now,
  };
}
