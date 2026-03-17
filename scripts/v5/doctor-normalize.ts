/**
 * doctor-normalize.ts
 *
 * 의사 데이터 필드 정규화: career/education/academic_activity를 키워드 패턴으로 재분류
 * - education: 대학, 인턴, 레지던트, 전문의 취득 등
 * - career: 병원 원장/과장, 교수, 군의관 등
 * - academic: 학회 정회원/임원, 논문, 수상, 교과서 등
 *
 * v1.0 - 2026-03-02
 */

import type { AcademicType, StructuredAcademic } from './types.js';

// ============================================================
// 분류 패턴 정의
// ============================================================

const EDUCATION_PATTERNS: RegExp[] = [
  /의과대학|의학과|의대|치과대학|치의학과|한의과대학|한의학과/,
  /졸업|학사|학위/,
  /인턴\b|인턴수료|인턴과정/,
  /레지던트|전공의|수련의|전임의/,
  /전문의\s*(취득|자격|면허)/,
  /석사|박사|Ph\.?D|M\.?D|M\.?S/,
  /수련\s*(수료|완료|과정)/,
];

interface AcademicPattern {
  type: AcademicType;
  patterns: RegExp[];
}

const ACADEMIC_PATTERNS: AcademicPattern[] = [
  {
    type: '학회정회원',
    patterns: [
      /학회\s*(정회원|종신회원|평생회원|회원$)/,
      /정회원|종신회원/,
      /member\s*(of|,)/i,
    ],
  },
  {
    type: '학회임원',
    patterns: [
      /학회\s*(회장|부회장|이사장|이사$|간사|총무|위원장|사무총장|상임이사)/,
      /회장|부회장|이사장/,
      /(대한|한국|아시아|세계|국제).*학회.*(회장|이사|간사|위원장)/,
      /president|vice.?president|board\s*director/i,
    ],
  },
  {
    type: '편집위원',
    patterns: [
      /편집위원|편집이사|편집장/,
      /editorial\s*board|reviewer|editor/i,
      /심사위원/,
    ],
  },
  {
    type: '교과서집필',
    patterns: [
      /교과서\s*(집필|저자|편찬|공저|참여)/,
      /textbook/i,
      /저서\s*(집필|출판|발간)/,
    ],
  },
  {
    type: '수상',
    patterns: [
      /학술상|최우수상|우수상|공로상|젊은.*상/,
      /수상$|수상\)/,
      /best\s*paper|award|prize/i,
    ],
  },
  {
    type: '논문',
    patterns: [
      /SCI\b|SCIE\b|KCI\b|SCOPUS/i,
      /논문\s*\d|편\s*논문|\d+\s*편/,
      /journal\s*of|published|publication/i,
      /제1저자|교신저자|공동저자|corresponding\s*author/i,
      /IF\s*\d|impact\s*factor/i,
    ],
  },
  {
    type: '강연',
    patterns: [
      /초청\s*(강연|연자|발표)/,
      /좌장|패널|moderator/i,
      /keynote|invited\s*(speaker|lecture)/i,
      /학술대회\s*(발표|연자)/,
    ],
  },
  {
    type: '임상연구',
    patterns: [
      /임상\s*(연구|시험|trial)/,
      /clinical\s*trial|PI\b|principal\s*investigator/i,
      /IRB\b|연구책임자/,
    ],
  },
];

const CAREER_PATTERNS: RegExp[] = [
  /\(전\)|\(현\)|전\)|현\)/,
  /원장|부원장|과장|실장|센터장|팀장/,
  /병원|의원|클리닉|센터/,
  /교수|부교수|조교수|겸임교수|임상교수/,
  /자문의|자문위원|촉탁의|군의관/,
  /근무|재직|역임/,
];

// ============================================================
// 분류 함수
// ============================================================

type FieldType = 'education' | 'career' | 'academic';

interface ClassifyResult {
  field: FieldType;
  academicType?: AcademicType;
}

function classifyItem(item: string): ClassifyResult {
  const trimmed = item.trim();
  if (!trimmed) return { field: 'career' };

  // 1) education 체크 (최우선)
  for (const pat of EDUCATION_PATTERNS) {
    if (pat.test(trimmed)) {
      // "~학회 정회원"이 교육에 매칭되는 일 방지
      if (/학회/.test(trimmed) && /정회원|종신회원|회원/.test(trimmed)) break;
      return { field: 'education' };
    }
  }

  // 2) academic 체크
  for (const ap of ACADEMIC_PATTERNS) {
    for (const pat of ap.patterns) {
      if (pat.test(trimmed)) {
        return { field: 'academic', academicType: ap.type };
      }
    }
  }

  // 3) career (나머지)
  return { field: 'career' };
}

// ============================================================
// 기존 academic_activity 텍스트 파싱
// ============================================================

function parseAcademicText(text: string): StructuredAcademic[] {
  if (!text) return [];

  const results: StructuredAcademic[] = [];
  // "[타입] 제목" 또는 "타입: 제목" 형태 파싱
  const lines = text.split(/[,\n;]/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // [타입] 제목 형태
    const bracketMatch = line.match(/^\[([^\]]+)\]\s*(.+)/);
    if (bracketMatch) {
      const rawType = bracketMatch[1].trim();
      const rawTitle = bracketMatch[2].trim();
      const type = mapToAcademicType(rawType);
      const year = extractYear(rawTitle);
      const title = stripTrailingYear(rawTitle, year);
      results.push({ type, title, year, source_text: line });
      continue;
    }

    // 일반 텍스트 → classifyItem으로 분류 시도
    const classified = classifyItem(line);
    if (classified.field === 'academic') {
      const year = extractYear(line);
      const title = stripTrailingYear(line, year);
      results.push({
        type: classified.academicType || '기타',
        title,
        year,
        source_text: line,
      });
    } else {
      // 학술활동 필드에 있었으므로 기타로 처리
      const year = extractYear(line);
      const title = stripTrailingYear(line, year);
      results.push({
        type: '기타',
        title,
        year,
        source_text: line,
      });
    }
  }

  return results;
}

function mapToAcademicType(raw: string): AcademicType {
  const map: Record<string, AcademicType> = {
    '논문': '논문', '학회임원': '학회임원', '학회정회원': '학회정회원',
    '수상': '수상', '교과서집필': '교과서집필', '교과서': '교과서집필',
    '편집위원': '편집위원', '임상연구': '임상연구', '강연': '강연',
    '학회발표': '강연', '기타': '기타',
  };
  return map[raw] || '기타';
}

function extractYear(text: string): string | null {
  const m = text.match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}

/** 제목에서 중복 연도 (YYYY) 제거 — 연도는 별도 필드에 저장 */
function stripTrailingYear(text: string, year: string | null): string {
  if (!year) return text;
  return text.replace(new RegExp(`\\s*\\(${year}\\)\\s*$`), '').trim() || text;
}

// ============================================================
// 중복 제거
// ============================================================

function normalizeForDedup(s: string): string {
  return s.replace(/[\s\(\)（）\[\]【】·•‧,，.。]/g, '').toLowerCase();
}

function dedup(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = normalizeForDedup(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupAcademics(items: StructuredAcademic[]): StructuredAcademic[] {
  const seen = new Set<string>();
  const result: StructuredAcademic[] = [];
  for (const item of items) {
    const key = `${item.type}::${normalizeForDedup(item.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// ============================================================
// 메인 정규화 함수
// ============================================================

interface NormalizeResult {
  education: string[];
  career: string[];
  academic_activities: StructuredAcademic[];
}

/**
 * 의사 raw 데이터의 career/education/academic_activity를 재분류
 */
export function normalizeDoctorFields(raw: {
  education?: string | string[] | null;
  career?: string | string[] | null;
  academic_activity?: string | null;
}): NormalizeResult {
  const education: string[] = [];
  const career: string[] = [];
  const academics: StructuredAcademic[] = [];

  // 배열/문자열 → 항목 목록으로 변환
  const toItems = (val: string | string[] | null | undefined): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.flatMap(v => v.split(/\n/)).map(v => v.trim()).filter(Boolean);
    return val.split(/\n|,\s*/).map(v => v.trim()).filter(Boolean);
  };

  // education 필드의 항목들 분류
  for (const item of toItems(raw.education)) {
    const result = classifyItem(item);
    if (result.field === 'education') {
      education.push(item);
    } else if (result.field === 'academic') {
      academics.push({
        type: result.academicType || '기타',
        title: item,
        year: extractYear(item),
        source_text: item,
      });
    } else {
      career.push(item);
    }
  }

  // career 필드의 항목들 분류
  for (const item of toItems(raw.career)) {
    const result = classifyItem(item);
    if (result.field === 'education') {
      education.push(item);
    } else if (result.field === 'academic') {
      academics.push({
        type: result.academicType || '기타',
        title: item,
        year: extractYear(item),
        source_text: item,
      });
    } else {
      career.push(item);
    }
  }

  // academic_activity 텍스트 파싱
  if (raw.academic_activity) {
    const parsed = parseAcademicText(raw.academic_activity);
    academics.push(...parsed);
  }

  // 3개 필드 간 중복 제거
  const dedupedEducation = dedup(education);
  const dedupedCareer = dedup(career);
  const dedupedAcademics = dedupAcademics(academics);

  // career/education 간 cross-dedup (education에 있으면 career에서 제거)
  const eduKeys = new Set(dedupedEducation.map(normalizeForDedup));
  const finalCareer = dedupedCareer.filter(c => !eduKeys.has(normalizeForDedup(c)));

  return {
    education: dedupedEducation,
    career: finalCareer,
    academic_activities: dedupedAcademics,
  };
}

/**
 * AnalysisResult.doctors 배열에 대해 일괄 정규화
 */
export function normalizeDoctorsBatch(doctors: Array<{
  name: string;
  education?: string | null;
  career?: string | null;
  academic_activity?: string | null;
  structured_academic?: StructuredAcademic[];
  [key: string]: unknown;
}>): void {
  for (const doc of doctors) {
    const result = normalizeDoctorFields({
      education: doc.education,
      career: doc.career,
      academic_activity: doc.academic_activity,
    });

    // education/career를 문자열로 재조립 (AnalysisResult 호환)
    doc.education = result.education.join('\n') || null;
    doc.career = result.career.join('\n') || null;
    doc.structured_academic = result.academic_activities;

    // academic_activity 텍스트도 갱신 (구조화된 항목들의 title 조합)
    if (result.academic_activities.length > 0) {
      doc.academic_activity = result.academic_activities
        .map(a => `[${a.type}] ${a.title}`)
        .join(', ');
    }
  }
}

export { classifyItem, parseAcademicText };
