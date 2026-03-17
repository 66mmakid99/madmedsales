import type { HospitalDataBundle, ProfilerScores, ScoringDetails } from './types.js';
import { RF_EQUIPMENT_KEYWORDS, PREMIUM_TREATMENT_KEYWORDS } from './types.js';

export function profileHospital(
  data: HospitalDataBundle,
): { scores: ProfilerScores; details: Omit<ScoringDetails, 'torrDetails'> } {
  const details = {
    investmentDetails: [] as string[],
    portfolioDetails: [] as string[],
    scaleDetails: [] as string[],
    marketingDetails: [] as string[],
  };

  // ─── Investment (35%) ─────────────────────────────────────
  let investment = 0;
  const equipCount = data.equipment.length;
  const equipBase = Math.min(40, equipCount * 10);
  investment += equipBase;
  details.investmentDetails.push(`매칭장비 ${equipCount}개 → ${equipBase}pt`);

  const hasRF = hasKeywordMatch(data, RF_EQUIPMENT_KEYWORDS);
  const hasHIFU = hasKeywordInEquipment(data, ['HIFU', '하이푸', '울쎄라', '울트라포머', '더블로', '슈링크']);
  const hasLaser = hasKeywordInEquipment(data, ['레이저', 'laser', '피코', 'pico', '프락셀', 'fraxel', '프락셔널']);

  if (hasRF) { investment += 20; details.investmentDetails.push('RF장비 +20'); }
  if (hasHIFU) { investment += 20; details.investmentDetails.push('HIFU장비 +20'); }
  if (hasLaser) { investment += 20; details.investmentDetails.push('레이저장비 +20'); }

  investment = Math.min(100, investment);

  // ─── Portfolio (25%) ──────────────────────────────────────
  let portfolio = 0;
  if (hasRF) { portfolio += 30; details.portfolioDetails.push('RF보유 +30'); }

  const categories = new Set(data.equipment.map((e) => e.category).filter(Boolean));
  const catScore = Math.min(40, categories.size * 8);
  portfolio += catScore;
  details.portfolioDetails.push(`카테고리 ${categories.size}종 → ${catScore}pt`);

  const premiumCount = countKeywordMatches(data, PREMIUM_TREATMENT_KEYWORDS);
  const premiumScore = Math.min(30, premiumCount * 10);
  portfolio += premiumScore;
  details.portfolioDetails.push(`프리미엄시술 ${premiumCount}개 → ${premiumScore}pt`);

  portfolio = Math.min(100, portfolio);

  // ─── Scale (25%) ──────────────────────────────────────────
  let scale = 0;
  const docScore = Math.min(40, Math.log2(data.doctorCount + 1) * 15);
  scale += docScore;
  details.scaleDetails.push(`의사 ${data.doctorCount}명 → ${Math.round(docScore)}pt`);

  const pageScore = Math.min(30, data.pages.total * 2);
  scale += pageScore;
  details.scaleDetails.push(`페이지 ${data.pages.total}개 → ${pageScore}pt`);

  if (data.pages.treatment > 0) { scale += 15; details.scaleDetails.push('시술페이지 +15'); }
  if (data.pages.price > 0) { scale += 15; details.scaleDetails.push('가격페이지 +15'); }

  scale = Math.min(100, scale);

  // ─── Marketing (15%) ──────────────────────────────────────
  let marketing = 0;
  const hasMarketingData = data.pages.event > 0 || data.pages.total > 0 || (data.snapshot?.pricing_found.length ?? 0) > 0;

  if (hasMarketingData) {
    const eventScore = Math.min(45, data.pages.event * 15);
    marketing += eventScore;
    details.marketingDetails.push(`이벤트 ${data.pages.event}개 → ${eventScore}pt`);

    if (data.snapshot && data.snapshot.pricing_found.length > 0) {
      marketing += 25;
      details.marketingDetails.push('가격투명성 +25');
    }

    const webScale = Math.min(30, data.pages.total * 1.5);
    marketing += webScale;
    details.marketingDetails.push(`웹규모 ${data.pages.total}p → ${Math.round(webScale)}pt`);

    marketing = Math.min(100, marketing);
  }

  // ─── Total (가중합) ───────────────────────────────────────
  let total: number;
  if (!hasMarketingData) {
    // 마케팅 데이터 없으면 가중치 재분배
    const baseSum = investment * 0.35 + portfolio * 0.25 + scale * 0.25;
    const redistFactor = 1 / 0.85; // 0.85 = 1 - 0.15
    total = baseSum * redistFactor;
    details.marketingDetails.push('데이터없음 → 가중치 재분배');
  } else {
    total = investment * 0.35 + portfolio * 0.25 + scale * 0.25 + marketing * 0.15;
  }

  return {
    scores: {
      investment: round2(investment),
      portfolio: round2(portfolio),
      scale: round2(scale),
      marketing: round2(marketing),
      total: round2(total),
    },
    details,
  };
}

// ─── Helpers ─────────────────────────────────────────────────
function hasKeywordMatch(data: HospitalDataBundle, keywords: string[]): boolean {
  const allText = getAllSearchableText(data);
  return keywords.some((kw) => allText.includes(kw.toLowerCase()));
}

function hasKeywordInEquipment(data: HospitalDataBundle, keywords: string[]): boolean {
  const equipText = data.equipment.map((e) => e.canonical_name.toLowerCase()).join(' ');
  const snapEquip = (data.snapshot?.equipments_found || []).join(' ').toLowerCase();
  const combined = equipText + ' ' + snapEquip;
  return keywords.some((kw) => combined.includes(kw.toLowerCase()));
}

function countKeywordMatches(data: HospitalDataBundle, keywords: string[]): number {
  const allText = getAllSearchableText(data);
  return keywords.filter((kw) => allText.includes(kw.toLowerCase())).length;
}

function getAllSearchableText(data: HospitalDataBundle): string {
  const parts: string[] = [];
  if (data.snapshot) {
    parts.push(...data.snapshot.equipments_found);
    parts.push(...data.snapshot.treatments_found);
    parts.push(...data.snapshot.pricing_found);
  }
  parts.push(...data.equipment.map((e) => e.canonical_name));
  return parts.join(' ').toLowerCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
