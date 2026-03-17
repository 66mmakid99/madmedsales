import type { HospitalDataBundle, TorrScores } from './types.js';
import {
  BRIDGE_KEYWORDS,
  POSTOP_KEYWORDS,
  MENS_KEYWORDS,
  PAINLESS_KEYWORDS,
  BODY_KEYWORDS,
} from './types.js';

export function matchTorr(data: HospitalDataBundle): { scores: TorrScores; details: Record<string, string[]> } {
  const searchText = buildSearchText(data);

  const bridgeResult = matchAxis(searchText, BRIDGE_KEYWORDS);
  const postopResult = matchAxis(searchText, POSTOP_KEYWORDS);
  const mensResult = matchAxis(searchText, MENS_KEYWORDS);
  const painlessResult = matchAxis(searchText, PAINLESS_KEYWORDS);
  const bodyResult = matchAxis(searchText, BODY_KEYWORDS);

  const bridge = axisScore(bridgeResult.count, BRIDGE_KEYWORDS.length);
  const postop = axisScore(postopResult.count, POSTOP_KEYWORDS.length);
  const mens = axisScore(mensResult.count, MENS_KEYWORDS.length);
  const painless = axisScore(painlessResult.count, PAINLESS_KEYWORDS.length);
  const body = axisScore(bodyResult.count, BODY_KEYWORDS.length);

  const total =
    bridge * 0.45 +
    postop * 0.25 +
    mens * 0.15 +
    painless * 0.10 +
    body * 0.05;

  return {
    scores: {
      bridge: round2(bridge),
      postop: round2(postop),
      mens: round2(mens),
      painless: round2(painless),
      body: round2(body),
      total: round2(total),
    },
    details: {
      bridge: bridgeResult.matched,
      postop: postopResult.matched,
      mens: mensResult.matched,
      painless: painlessResult.matched,
      body: bodyResult.matched,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────
function buildSearchText(data: HospitalDataBundle): string {
  const parts: string[] = [];
  if (data.snapshot) {
    parts.push(...data.snapshot.equipments_found);
    parts.push(...data.snapshot.treatments_found);
    parts.push(...data.snapshot.pricing_found);
  }
  parts.push(...data.equipment.map((e) => e.canonical_name));
  return parts.join(' ').toLowerCase();
}

function matchAxis(
  searchText: string,
  keywords: string[],
): { count: number; matched: string[] } {
  const matched: string[] = [];
  for (const kw of keywords) {
    if (searchText.includes(kw.toLowerCase())) {
      matched.push(kw);
    }
  }
  return { count: matched.length, matched };
}

function axisScore(matchCount: number, totalKeywords: number): number {
  if (matchCount === 0) return 0;
  // 매칭 비율 기반 점수 (최소 1개 매칭 시 기본 20점)
  const ratio = matchCount / totalKeywords;
  const score = 20 + ratio * 80;
  return Math.min(100, round2(score));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
