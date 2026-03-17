// v2.0 - 2026-03-16
// Lead interest level calculation based on weighted engagement score + time decay
// Design: docs/05-RESPONSE.md Section 3

import type { InterestLevel } from '@madmedsales/shared';

interface LeadEngagement {
  replyCount: number;
  clickCount: number;
  openCount: number;
  demoPageVisits: number;
  pricePageVisits: number;
  productPageVisits?: number;
  lastReplySentiment: string | null;
  lastActivityAt?: string | null; // ISO timestamp for time decay
}

// 가중치 상수 (설계 docs/05-RESPONSE.md)
const WEIGHTS = {
  open: 3,
  click: 10,
  reply: 30,
  demo: 20,
  price: 15,
  product: 8,
} as const;

// 관심도 임계값
const THRESHOLDS = {
  hot: 80,
  warm: 40,
  warming: 15,
} as const;

/**
 * 시간 감쇠 배율 계산
 * 최근 1일: x1.5, 3일 이내: x1.2, 14일 초과: x0.5, 나머지: x1.0
 */
function getTimeDecayMultiplier(lastActivityAt: string | null | undefined): number {
  if (!lastActivityAt) return 1.0;

  const nowMs = Date.now();
  const activityMs = new Date(lastActivityAt).getTime();
  const diffDays = (nowMs - activityMs) / (1000 * 60 * 60 * 24);

  if (diffDays <= 1) return 1.5;
  if (diffDays <= 3) return 1.2;
  if (diffDays > 14) return 0.5;
  return 1.0;
}

/**
 * 가중치 점수 합산으로 관심도 레벨 계산
 *
 * score = open*3 + click*10 + reply*30 + demo*20 + price*15 + product*8
 *       * time_decay
 * hot: score>=80, warm: >=40, warming: >=15, cold: else
 */
export function calculateInterestLevel(lead: LeadEngagement): InterestLevel {
  const rawScore =
    lead.openCount * WEIGHTS.open +
    lead.clickCount * WEIGHTS.click +
    lead.replyCount * WEIGHTS.reply +
    lead.demoPageVisits * WEIGHTS.demo +
    lead.pricePageVisits * WEIGHTS.price +
    (lead.productPageVisits ?? 0) * WEIGHTS.product;

  const decay = getTimeDecayMultiplier(lead.lastActivityAt);
  const score = rawScore * decay;

  if (score >= THRESHOLDS.hot) return 'hot';
  if (score >= THRESHOLDS.warm) return 'warm';
  if (score >= THRESHOLDS.warming) return 'warming';
  return 'cold';
}

/**
 * 가중치 점수 수치 반환 (디버깅/모니터링용)
 */
export function calculateInterestScore(lead: LeadEngagement): number {
  const rawScore =
    lead.openCount * WEIGHTS.open +
    lead.clickCount * WEIGHTS.click +
    lead.replyCount * WEIGHTS.reply +
    lead.demoPageVisits * WEIGHTS.demo +
    lead.pricePageVisits * WEIGHTS.price +
    (lead.productPageVisits ?? 0) * WEIGHTS.product;

  const decay = getTimeDecayMultiplier(lead.lastActivityAt);
  return Math.round(rawScore * decay * 10) / 10;
}
