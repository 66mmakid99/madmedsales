/**
 * MADMEDSALES 데이터 사전 로더
 * JSON 사전을 한 번만 읽고 캐시하여 Gemini 프롬프트에 주입
 *
 * v1.4 - 2026-02-26
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_PATH = path.resolve(__dirname, 'MADMEDSALES_dictionary_v1.4.json');

// ── 타입 ──

interface EquipmentEntry {
  standard: string;
  ko: string[];
  en: string[];
  gen: string[];
  subtype?: string;
}

interface PriceUnit {
  ko: string[];
  en: string[];
  typical_equipment: string[];
}

interface ExcludeRules {
  non_derma_categories: string[];
  noise_patterns: string[];
  blacklist_domains: string[];
  non_content_signals: string[];
  non_aesthetic_devices?: string[];
  too_generic_terms?: string[];
  manufacturer_names?: string[];
  ambiguous_conflation?: string[];
}

interface DictionaryData {
  equipment: Record<string, EquipmentEntry[]>;
  treatment_keywords: Record<string, string[]>;
  price_units: Record<string, PriceUnit>;
  exclude: ExcludeRules;
  torr_rf_keywords: string[];
}

// ── 캐시 (한 번만 로드) ──

let _cache: DictionaryData | null = null;

function loadDict(): DictionaryData {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(DICT_PATH, 'utf-8'));
  _cache = {
    equipment: raw.equipment,
    treatment_keywords: raw.treatment_keywords,
    price_units: raw.price_units,
    exclude: raw.exclude,
    torr_rf_keywords: raw.torr_rf_keywords,
  };
  return _cache;
}

// ── 작업 1 API: 프롬프트 섹션 생성 ──

/**
 * 장비 분류용 프롬프트 텍스트.
 * R1 규칙 + 장비 사전(한/영 키워드)을 Gemini가 이해할 수 있는 압축 형태로 변환.
 */
export function getEquipmentPromptSection(): string {
  const d = loadDict();
  const lines: string[] = [];

  lines.push('### 장비 분류 규칙 (R1)');
  lines.push('');
  lines.push('R1-1. 장비명=시술명 이중 분류: 사전에 등록된 브랜드명이 시술/메뉴/이벤트/가격표 어디에든 등장하면 equipments와 treatments 양쪽에 넣어라.');
  lines.push('R1-2. 정규화: 한글 변형 → 표준 영문명으로 변환. 모델/세대(FLX, CPT, Prime 등)는 분리 보존.');
  lines.push('R1-3. TORR RF 특별 감지: "토르", "TORR", "MPR", "토로이달" 중 하나라도 있으면 반드시 포함.');
  lines.push('R1-4. 미등록 장비: 사전에 없는 장비명도 equipments에 원문 포함 + unregistered_equipment에 추가. 절대 버리지 마라.');
  lines.push('R1-5. INJECTABLE 약제도 장비 사전에 포함됨. 보톡스/필러 브랜드명 발견 시 반드시 equipments에 포함.');
  lines.push('');

  // 카테고리별 장비 목록 명시 (작업 6: subcategory 검증)
  lines.push('### 카테고리별 장비 목록 (subcategory 분류 기준)');
  lines.push('');
  const categoryDescriptions: Record<string, string> = {
    RF_TIGHTENING: 'RF 타이트닝 장비',
    HIFU: 'HIFU 장비',
    RF_MICRONEEDLE: 'RF 마이크로니들 장비',
    LASER: '레이저 장비',
    IPL: 'IPL 장비',
    BODY: '바디 장비',
    SKINBOOSTER: '스킨부스터',
    INJECTOR: '약물주입 장비',
    OTHER_DEVICE: '기타 장비',
    INJECTABLE: '약제 (보톡스/필러)',
  };
  for (const [category, entries] of Object.entries(d.equipment)) {
    if (category.startsWith('_')) continue;
    const desc = categoryDescriptions[category] || category;
    const names = (entries as EquipmentEntry[]).map(e => `${e.ko[0] || e.standard}(${e.standard})`).join(', ');
    lines.push(`- **${desc}**: ${names}`);
  }
  lines.push('');
  lines.push('장비의 subcategory를 분류할 때 위 목록을 기준으로 하세요. 예: FairTitanium은 RF_TIGHTENING입니다 (LASER 아님).');
  lines.push('');

  lines.push('### 장비 사전 (정규화 테이블)');
  lines.push('');
  lines.push('| 표준명 | 한글 키워드 | 영문 키워드 | 모델/세대 | 카테고리 |');
  lines.push('|--------|-----------|-----------|----------|---------|');

  for (const [category, entries] of Object.entries(d.equipment)) {
    if (category.startsWith('_')) continue;
    for (const e of entries) {
      const ko = e.ko.join(', ');
      const en = e.en.filter(x => x !== e.standard).join(', ');
      const gen = e.gen.length > 0 ? e.gen.join(', ') : '-';
      const subtypeStr = e.subtype ? ` (${e.subtype})` : '';
      lines.push(`| ${e.standard} | ${ko} | ${en || '-'} | ${gen} | ${category}${subtypeStr} |`);
    }
  }

  lines.push('');
  lines.push('위 키워드 중 하나라도 등장하면 반드시 medical_devices/equipments에 포함시켜라.');

  return lines.join('\n');
}

/**
 * 시술 키워드용 프롬프트 텍스트.
 * R2 규칙 + 시술 키워드 목록.
 */
export function getTreatmentPromptSection(): string {
  const d = loadDict();
  const lines: string[] = [];

  lines.push('### 시술 분류 규칙 (R2)');
  lines.push('');
  lines.push('R2-1. 시술명만 추출. 해시태그(#), 이모지, 감탄문, 홍보문구는 제외.');
  lines.push('R2-2. 합성어 시술명(장비+부위/수량): 원문 보존 + 장비명/수량/부위 별도 파싱.');
  lines.push('  예: "써마지 아이" → 장비:써마지, 부위:눈가, 시술명:"써마지 아이"');
  lines.push('  예: "울쎄라 300샷" → 장비:울쎄라, 수량:300샷, 시술명:"울쎄라 300샷"');
  lines.push('R2-3. 5자 미만 제외, 50자 초과 제외, 동일 시술 중복 제거.');
  lines.push('R2-4. 미등록 시술: 사전에 없어도 문맥상 시술이면 추출 + unregistered_treatments에 추가.');
  lines.push('');
  lines.push('### 시술 키워드 사전');
  lines.push('');

  for (const [category, keywords] of Object.entries(d.treatment_keywords)) {
    if (category.startsWith('_')) continue;
    lines.push(`**${category}**: ${keywords.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * 가격 파싱용 프롬프트 텍스트.
 * R3 규칙 + 단위 사전.
 */
export function getPricePromptSection(): string {
  const d = loadDict();
  const lines: string[] = [];

  lines.push('### 가격 분류 규칙 (R3)');
  lines.push('');
  lines.push('R3-2. 가격 3분류:');
  lines.push('  - regular: 단독 가격, "정가", "기본가"');
  lines.push('  - event: "이벤트", "특가", "~월 한정", 기간 명시');
  lines.push('  - discount: 정가→할인가 패턴, "%할인", 취소선');
  lines.push('R3-3. 수량+단위 파싱: 가격에 수량이 붙어있으면 분리하여 price_per_unit 계산.');
  lines.push('R3-5. 파싱 실패한 가격 텍스트도 raw_price_texts에 원문 보존.');
  lines.push('');
  lines.push('### 가격 단위 사전');
  lines.push('');
  lines.push('| 단위 | 한글 | 영문 | 주요 장비 |');
  lines.push('|------|------|------|----------|');

  for (const [unit, info] of Object.entries(d.price_units)) {
    if (unit.startsWith('_')) continue;
    lines.push(`| ${unit} | ${info.ko.join('/')} | ${info.en.join('/')} | ${info.typical_equipment.join(', ') || '-'} |`);
  }

  return lines.join('\n');
}

/**
 * 제외 필터용 프롬프트 텍스트.
 * R6 규칙.
 */
export function getExcludePromptSection(): string {
  const d = loadDict();
  const lines: string[] = [];

  lines.push('### 외부 콘텐츠 차단 규칙 (R6)');
  lines.push('');
  lines.push('R6-1. 크롤링 대상 도메인과 다른 도메인 콘텐츠는 분석에서 제외.');
  lines.push(`R6-2. 블랙리스트 도메인(리뷰/비교 사이트): ${d.exclude.blacklist_domains.join(', ')}`);
  lines.push(`R6-3. 비콘텐츠 신호: ${d.exclude.non_content_signals.join(', ')}`);
  lines.push(`R6-4. 비피부과 키워드(이것만 있으면 피부시술 병원 아님): ${d.exclude.non_derma_categories.join(', ')}`);

  return lines.join('\n');
}

// ── 작업 3 API: 장비 정규화 맵 ──

/**
 * 모든 한글/영문 변형 → 표준 이름 매핑.
 * 코드 레벨에서 장비명 정규화에 사용.
 */
export function getEquipmentNormalizationMap(): Map<string, string> {
  const d = loadDict();
  const map = new Map<string, string>();

  for (const entries of Object.values(d.equipment)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      // 표준명 자체
      map.set(e.standard.toLowerCase(), e.standard);
      // 한글 변형
      for (const ko of e.ko) {
        map.set(ko.toLowerCase(), e.standard);
      }
      // 영문 변형
      for (const en of e.en) {
        map.set(en.toLowerCase(), e.standard);
      }
      // 세대 조합
      for (const gen of e.gen) {
        map.set(`${e.standard} ${gen}`.toLowerCase(), `${e.standard} ${gen}`);
        for (const ko of e.ko) {
          map.set(`${ko}${gen}`.toLowerCase(), `${e.standard} ${gen}`);
          map.set(`${ko} ${gen}`.toLowerCase(), `${e.standard} ${gen}`);
        }
      }
    }
  }

  return map;
}

/**
 * 장비 표준명 → 카테고리 매핑.
 * INJECTABLE의 subtype도 포함.
 */
export function getEquipmentCategoryMap(): Map<string, { category: string; subtype?: string }> {
  const d = loadDict();
  const map = new Map<string, { category: string; subtype?: string }>();

  for (const [category, entries] of Object.entries(d.equipment)) {
    if (category.startsWith('_')) continue;
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      map.set(e.standard.toLowerCase(), {
        category,
        subtype: e.subtype,
      });
    }
  }

  return map;
}

// ── 작업 4 API: TORR RF 키워드 ──

/**
 * TORR RF 감지용 키워드 배열.
 */
export function getTorrKeywords(): string[] {
  const d = loadDict();
  return [...d.torr_rf_keywords];
}

// ── 프롬프트용 압축 장비 리스트 (screenshot-ocr용) ──

/**
 * 한 줄로 압축한 장비 브랜드명 목록 (screenshot OCR 프롬프트용).
 */
export function getEquipmentBrandList(): string {
  const d = loadDict();
  const brands: string[] = [];

  for (const entries of Object.values(d.equipment)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      // 대표 한글명/표준명만 추출
      const repr = e.ko[0] || e.standard;
      const eng = e.en[0] && e.en[0] !== e.standard ? `/${e.en[0]}` : '';
      brands.push(`${repr}${eng}`);
    }
  }

  return brands.join(', ');
}

/**
 * 장비명 정규화 테이블 (프롬프트용 간결 버전).
 * buildExtractionPrompt, buildImageBannerPrompt에서 사용.
 */
export function getEquipmentNormalizationTable(): string {
  const d = loadDict();
  const lines: string[] = [];

  lines.push('| 한글/약어 | 정규화 |');
  lines.push('|-----------|--------|');

  for (const entries of Object.values(d.equipment)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const koStr = e.ko.join(', ');
      const genStr = e.gen.length > 0 ? ` (${e.gen.join('/')})` : '';
      lines.push(`| ${koStr} | ${e.standard}${genStr} |`);
    }
  }

  return lines.join('\n');
}
