import type { ScoringResult } from './types.js';

/**
 * 백분위 정규화: 각 점수를 코호트 내 백분위(0~100)로 변환
 */
export function percentileNormalize(scores: number[]): number[] {
  if (scores.length === 0) return [];
  if (scores.length === 1) return [50]; // 단일 항목은 중간값

  const sorted = [...scores].sort((a, b) => a - b);
  return scores.map((score) => {
    const rank = sorted.filter((s) => s < score).length;
    return round2((rank / (scores.length - 1)) * 100);
  });
}

/**
 * 전체 병원 코호트에 대해 백분위 정규화 후 가중합 계산
 */
export function normalizeAndWeight(results: ScoringResult[]): ScoringResult[] {
  if (results.length === 0) return [];

  // 각 축별 raw 점수 추출
  const inv = results.map((r) => r.profiler.investment);
  const port = results.map((r) => r.profiler.portfolio);
  const scale = results.map((r) => r.profiler.scale);
  const mkt = results.map((r) => r.profiler.marketing);

  const bridge = results.map((r) => r.torr.bridge);
  const postop = results.map((r) => r.torr.postop);
  const mens = results.map((r) => r.torr.mens);
  const painless = results.map((r) => r.torr.painless);
  const body = results.map((r) => r.torr.body);

  // 백분위 정규화
  const nInv = percentileNormalize(inv);
  const nPort = percentileNormalize(port);
  const nScale = percentileNormalize(scale);
  const nMkt = percentileNormalize(mkt);

  const nBridge = percentileNormalize(bridge);
  const nPostop = percentileNormalize(postop);
  const nMens = percentileNormalize(mens);
  const nPainless = percentileNormalize(painless);
  const nBody = percentileNormalize(body);

  return results.map((r, i) => {
    const totalScore = round2(
      nInv[i] * 0.35 + nPort[i] * 0.25 + nScale[i] * 0.25 + nMkt[i] * 0.15,
    );

    const torrTotal = round2(
      nBridge[i] * 0.45 + nPostop[i] * 0.25 + nMens[i] * 0.15 + nPainless[i] * 0.10 + nBody[i] * 0.05,
    );

    const finalScore = round2(totalScore * 0.5 + torrTotal * 0.5);

    return {
      ...r,
      profiler: {
        ...r.profiler,
        total: totalScore,
      },
      torr: {
        ...r.torr,
        total: torrTotal,
      },
      finalScore,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
