/**
 * 5-axis scoring calculator
 * Each function calculates a score from 0-100 for a specific axis.
 */
import type { CompetitorData } from '@madmedsales/shared';

interface EquipmentInput {
  equipment_name: string;
  equipment_brand: string | null;
  equipment_category: string;
  estimated_year: number | null;
}

interface TreatmentInput {
  treatment_name: string;
  treatment_category: string;
  price_min: number | null;
  price_max: number | null;
  is_promoted: boolean;
}

interface HospitalInput {
  opened_at: string | null;
}

/**
 * Axis 1: Equipment Synergy (default weight 25%)
 * Evaluates whether TORR RF would complement existing equipment.
 */
export function scoreEquipmentSynergy(equipments: EquipmentInput[]): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  const hasRF = equipments.some((e) => e.equipment_category === 'rf');
  const rfEquipments = equipments.filter((e) => e.equipment_category === 'rf');

  // RF ownership (max 40 points)
  if (!hasRF) {
    // No RF = big gap in portfolio = high adoption motivation
    score += 40;
  } else {
    // Has RF -> check how old it is
    const oldestYear = Math.min(
      ...rfEquipments.map((e) => e.estimated_year ?? currentYear)
    );
    const age = currentYear - oldestYear;
    if (age >= 5) score += 30; // 5+ years, replacement candidate
    else if (age >= 3) score += 15; // 3-4 years, possible addition
    else score += 5; // Recent RF, low motivation
  }

  // Complementary equipment (max 35 points)
  const hasUltrasound = equipments.some(
    (e) => e.equipment_category === 'ultrasound'
  );
  const hasLaser = equipments.some((e) => e.equipment_category === 'laser');
  const hasIPL = equipments.some((e) => e.equipment_category === 'ipl');

  if (hasUltrasound) score += 20; // RF + ultrasound = full lifting course
  if (hasLaser) score += 10; // Laser = treatment diversity
  if (hasIPL) score += 5;

  // Equipment count as investment tendency (max 25 points)
  const totalEquipments = equipments.length;
  if (totalEquipments >= 5) score += 25;
  else if (totalEquipments >= 3) score += 15;
  else if (totalEquipments >= 1) score += 10;

  return Math.min(score, 100);
}

/**
 * Axis 2: Equipment Age (default weight 20%)
 * Evaluates whether existing RF equipment is due for replacement.
 */
export function scoreEquipmentAge(equipments: EquipmentInput[]): number {
  const currentYear = new Date().getFullYear();
  const rfEquipments = equipments.filter(
    (e) => e.equipment_category === 'rf'
  );

  // No RF = new adoption opportunity
  if (rfEquipments.length === 0) return 80;

  const years = rfEquipments
    .map((e) => e.estimated_year)
    .filter((y): y is number => y !== null);

  // No year info = middle value
  if (years.length === 0) return 50;

  const oldestYear = Math.min(...years);
  const age = currentYear - oldestYear;

  if (age >= 7) return 100; // 7+ years: immediate replacement needed
  if (age >= 5) return 85; // 5-6 years: replacement timing
  if (age >= 4) return 65; // 4 years: starting to consider
  if (age >= 3) return 45; // 3 years: still active
  if (age >= 2) return 25; // 2 years: no need
  return 10; // Within 1 year: just purchased
}

/**
 * Axis 3: Revenue Impact (default weight 30%)
 * Evaluates how much TORR RF adoption would impact hospital revenue.
 */
export function scoreRevenueImpact(
  treatments: TreatmentInput[],
  equipments: EquipmentInput[]
): number {
  let score = 0;
  const hasRF = equipments.some((e) => e.equipment_category === 'rf');

  // Lifting/tightening demand (max 35 points)
  const liftingTreatments = treatments.filter((t) =>
    ['lifting', 'tightening'].includes(t.treatment_category)
  );

  if (liftingTreatments.length >= 3) score += 35; // Lifting specialist
  else if (liftingTreatments.length >= 1) score += 25; // Has lifting menu
  else score += 10; // No lifting menu (new opportunity)

  // Demand exists but no equipment = golden target (max 25 points)
  if (!hasRF && liftingTreatments.length > 0) {
    score += 25; // Verified demand + equipment gap
  } else if (!hasRF) {
    score += 10; // Unverified demand but gap exists
  }

  // Treatment price level (max 20 points)
  const prices = treatments
    .map((t) => t.price_min)
    .filter((p): p is number => p !== null && p > 0);

  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avgPrice >= 300000) score += 20; // High-end focus
    else if (avgPrice >= 150000) score += 15;
    else if (avgPrice >= 80000) score += 10;
    else score += 5;
  }

  // Anti-aging focus (max 20 points)
  const antiAgingCategories = [
    'lifting',
    'tightening',
    'toning',
    'filler',
    'botox',
  ];
  const antiAgingRatio =
    treatments.filter((t) =>
      antiAgingCategories.includes(t.treatment_category)
    ).length / Math.max(treatments.length, 1);

  if (antiAgingRatio >= 0.5) score += 20;
  else if (antiAgingRatio >= 0.3) score += 15;
  else if (antiAgingRatio >= 0.1) score += 10;
  else score += 5;

  return Math.min(score, 100);
}

/**
 * Axis 4: Competitive Edge (default weight 15%)
 * Evaluates differentiation potential in the local market.
 */
export function scoreCompetitiveEdge(competitors: CompetitorData[]): number {
  let score = 0;
  const total = competitors.length;

  if (total === 0) {
    return 50; // No market data, use middle value
  }

  // Modern RF penetration in the area (max 50 points)
  const withModernRF = competitors.filter((c) => c.hasModernRF).length;
  const rfPenetration = withModernRF / total;

  if (rfPenetration === 0) score += 50; // No RF = first-mover opportunity
  else if (rfPenetration < 0.1) score += 40;
  else if (rfPenetration < 0.2) score += 30;
  else if (rfPenetration < 0.3) score += 20;
  else if (rfPenetration < 0.5) score += 10;
  else score += 5; // Already saturated

  // Market density (max 30 points)
  if (total >= 15) score += 30; // Extremely dense (Gangnam level)
  else if (total >= 10) score += 25;
  else if (total >= 5) score += 15;
  else score += 10;

  // Treatment diversity vs competitors (max 20 points)
  // Simplified: base value, can be refined later
  score += 10;

  return Math.min(score, 100);
}

/**
 * Axis 5: Purchase Readiness (default weight 10%)
 * Evaluates whether the hospital can realistically make a purchase.
 */
export function scorePurchaseReadiness(
  hospital: HospitalInput,
  equipments: EquipmentInput[]
): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  // Opening year (max 40 points)
  if (hospital.opened_at) {
    const openYear = new Date(hospital.opened_at).getFullYear();
    const yearsOpen = currentYear - openYear;

    if (yearsOpen >= 2 && yearsOpen <= 5) score += 40; // Expansion phase (optimal)
    else if (yearsOpen >= 6 && yearsOpen <= 10) score += 30; // Stable phase (replacement)
    else if (yearsOpen >= 1 && yearsOpen < 2) score += 20; // Early (still investing)
    else if (yearsOpen > 10) score += 25; // Old hospital (renovation possible)
    else score += 10; // Under 1 year
  } else {
    score += 20; // No opening date info, use middle value
  }

  // Recent equipment investment history (max 40 points)
  const recentEquipments = equipments.filter(
    (e) => e.estimated_year !== null && currentYear - e.estimated_year <= 2
  );

  if (recentEquipments.length >= 2) score += 40; // Actively investing
  else if (recentEquipments.length === 1) score += 30; // Has investment history
  else {
    if (equipments.length === 0) score += 15; // Data lacking
    else score += 10; // Conservative
  }

  // Base bonus: email available = reachable (max 20 points)
  score += 20;

  return Math.min(score, 100);
}
