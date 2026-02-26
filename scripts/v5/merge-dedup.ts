/**
 * v5 결과 병합 + 중복 제거
 * 시스템 지침서 섹션 3-4 구현
 */
import type { AnalysisResult } from './types.js';

// ============================================================
// 장비명 정규화 맵 (시술명에서 장비 추출 시에도 사용)
// ============================================================
const EQUIPMENT_NORMALIZE: Record<string, string> = {
  '써마지': 'Thermage FLX', '써마지flx': 'Thermage FLX', 'thermage': 'Thermage FLX', 'thermage flx': 'Thermage FLX',
  '써마지cpt': 'Thermage CPT', 'thermage cpt': 'Thermage CPT',
  '울쎄라': 'Ulthera', 'ulthera': 'Ulthera', '울쎄라프라임': 'Ulthera Prime', 'ulthera prime': 'Ulthera Prime',
  '슈링크': 'Shrink Universe', '슈링크유니버스': 'Shrink Universe', 'shrink': 'Shrink Universe', 'shrink universe': 'Shrink Universe',
  '인모드': 'InMode', '인모드fx': 'InMode', 'inmode': 'InMode',
  '토르': 'TORR RF', '토르rf': 'TORR RF', 'torr': 'TORR RF', 'torr rf': 'TORR RF',
  '토르 컴포트 듀얼': 'TORR Comfort Dual', '컴포트듀얼': 'TORR Comfort Dual', 'torr comfort dual': 'TORR Comfort Dual',
  '텐쎄라': 'Tensera', 'tensera': 'Tensera',
  '텐써마': 'Tensurma', 'tensurma': 'Tensurma',
  '스칼렛s': 'Scarlet S', 'scarlet s': 'Scarlet S', 'scarlet': 'Scarlet S',
  '레블라이트si': 'RevLite SI', 'revlite': 'RevLite SI', 'revlite si': 'RevLite SI',
  '엑셀v': 'Excel V', 'excel v': 'Excel V', 'excelv': 'Excel V',
  '피코슈어': 'PicoSure', 'picosure': 'PicoSure',
  '제네시스': 'Genesis', 'genesis': 'Genesis',
  '온다': 'Onda', 'onda': 'Onda',
  '젤틱': 'CoolSculpting (Zeltiq)', 'coolsculpting': 'CoolSculpting (Zeltiq)', 'zeltiq': 'CoolSculpting (Zeltiq)',
  'ldm': 'LDM',
  '에너젯': 'E-Jet', 'e-jet': 'E-Jet',
  '리포소닉': 'Liposonic', 'liposonic': 'Liposonic',
  '포텐자': 'Potenza', 'potenza': 'Potenza',
  '올리지오': 'Oligio', 'oligio': 'Oligio',
  '아그네스': 'Agnes', 'agnes': 'Agnes',
  '덴서티': 'Density', 'density': 'Density',
  '원쎄라': 'Wonsera', 'wonsera': 'Wonsera',
};

function normalizeEquipmentName(name: string): string {
  const lower = name.toLowerCase().trim();
  return EQUIPMENT_NORMALIZE[lower] || name.trim();
}

// ============================================================
// 병합 + 중복 제거
// ============================================================
export function mergeAndDeduplicate(results: AnalysisResult[]): AnalysisResult {
  const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

  for (const r of results) {
    if (r.equipments) merged.equipments.push(...r.equipments);
    if (r.treatments) merged.treatments.push(...r.treatments);
    if (r.doctors) merged.doctors.push(...r.doctors);
    if (r.events) merged.events.push(...r.events);
  }

  // 장비 중복 제거 (정규화 후 매칭)
  const eqMap = new Map<string, typeof merged.equipments[0]>();
  for (const eq of merged.equipments) {
    const normalized = normalizeEquipmentName(eq.name);
    eq.name = normalized;
    const key = normalized.toLowerCase();
    if (!eqMap.has(key) || (!eqMap.get(key)!.manufacturer && eq.manufacturer)) {
      eqMap.set(key, eq);
    }
  }
  merged.equipments = [...eqMap.values()];

  // 시술 중복 제거
  // 1차: 정확 name 매칭 (가격 있는 쪽 우선)
  // 2차: 이벤트 패키지 → events로 재분류
  const trMap = new Map<string, typeof merged.treatments[0]>();
  const eventPackages: typeof merged.events = [];

  for (const tr of merged.treatments) {
    const name = tr.name.trim();
    const key = name.toLowerCase();

    // 이벤트성 패키지 감지 (복주머니, P!CK, 특가 패키지 등)
    if (/복주머니|p!ck|특가\s*패키지|세트\s*이벤트/i.test(name) && !tr.price) {
      eventPackages.push({
        title: name,
        description: tr.combo_with || null,
        discount_type: 'package',
        discount_value: tr.price_note || null,
        related_treatments: tr.combo_with ? [tr.combo_with] : [],
      });
      continue;
    }

    if (!trMap.has(key)) {
      trMap.set(key, tr);
    } else {
      const existing = trMap.get(key)!;
      // 가격 있는 쪽 우선
      if (!existing.price && tr.price) {
        trMap.set(key, tr);
      }
      // 프로모션 정보 있는 쪽 우선
      if (!existing.is_promoted && tr.is_promoted) {
        trMap.set(key, { ...existing, is_promoted: true, price_note: tr.price_note || existing.price_note });
      }
    }
  }
  merged.treatments = [...trMap.values()];

  // 이벤트 패키지 추가
  merged.events.push(...eventPackages);

  // 의사 중복 제거 (name 기준, 정보 많은 쪽 우선)
  const drMap = new Map<string, typeof merged.doctors[0]>();
  for (const dr of merged.doctors) {
    if (!dr || !dr.name) continue;
    const key = dr.name.trim();
    if (!drMap.has(key)) {
      drMap.set(key, dr);
    } else {
      const existing = drMap.get(key)!;
      const existCount = [existing.education, existing.career, existing.academic_activity, existing.specialty].filter(Boolean).length;
      const newCount = [dr.education, dr.career, dr.academic_activity, dr.specialty].filter(Boolean).length;
      if (newCount > existCount) {
        drMap.set(key, { ...existing, ...dr });
      } else if (newCount === existCount) {
        // 더 긴 정보 우선
        const merged = { ...existing };
        if (dr.education && (!existing.education || dr.education.length > existing.education.length)) merged.education = dr.education;
        if (dr.career && (!existing.career || dr.career.length > existing.career.length)) merged.career = dr.career;
        if (dr.academic_activity && (!existing.academic_activity || dr.academic_activity.length > existing.academic_activity.length)) merged.academic_activity = dr.academic_activity;
        drMap.set(key, merged);
      }
    }
  }
  merged.doctors = [...drMap.values()];

  // 이벤트 중복 제거
  const evMap = new Map<string, typeof merged.events[0]>();
  for (const ev of merged.events) {
    const key = ev.title.toLowerCase().trim();
    if (!evMap.has(key)) evMap.set(key, ev);
  }
  merged.events = [...evMap.values()];

  return merged;
}
