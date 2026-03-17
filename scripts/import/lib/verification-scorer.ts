/**
 * 검증 결과 점수 판정 로직
 */
import { normalizeAddressStr } from './address-normalizer.js';

export type VerificationStatus = 'verified' | 'partial' | 'needs_review' | 'suspicious';

export interface VerificationResult {
  status: VerificationStatus;
  method: string;
  phoneMatch: boolean;
  addrMatch: boolean;
  nameSim: number;
  detail: Record<string, unknown>;
}

// 전화번호 정규화 (숫자만)
export function normalizePhone(p: string): string {
  return (p ?? '').replace(/[^0-9]/g, '');
}

// 문자열 유사도 (Levenshtein)
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

export interface VerificationCandidate {
  name: string;
  address: string;
  phone: string;
}

/**
 * DB 병원 정보와 외부 API 결과를 비교하여 검증 상태 판정
 */
export function scoreVerification(
  db: { name: string; phone: string | null; address: string | null },
  candidates: VerificationCandidate[],
  method: string,
): VerificationResult | null {
  if (candidates.length === 0) return null;

  const dbPhone = normalizePhone(db.phone ?? '');
  const dbAddrNorm = normalizeAddressStr(db.address ?? '');
  const dbNameNorm = db.name.replace(/\s/g, '').toLowerCase();

  let best: VerificationResult | null = null;

  for (const cand of candidates) {
    const candPhone = normalizePhone(cand.phone);
    const candAddrNorm = normalizeAddressStr(cand.address);
    const candNameNorm = cand.name.replace(/\s/g, '').toLowerCase();

    const phoneMatch = dbPhone.length >= 8 && candPhone.length >= 8 && dbPhone === candPhone;
    const addrMatch  = candAddrNorm.length > 5 && similarity(dbAddrNorm, candAddrNorm) >= 0.70;
    const nameSim    = similarity(dbNameNorm, candNameNorm);

    let status: VerificationStatus;
    if (phoneMatch || addrMatch) {
      status = 'verified';
    } else if (nameSim >= 0.75) {
      status = 'partial';
    } else if (nameSim < 0.40 && candidates.length === 1) {
      // 검색 결과가 1개이고 이름이 너무 다르면 의심
      status = 'suspicious';
    } else {
      status = 'needs_review';
    }

    const result: VerificationResult = {
      status, method, phoneMatch, addrMatch, nameSim,
      detail: {
        cand_name:  cand.name,
        cand_phone: cand.phone,
        cand_addr:  cand.address.slice(0, 60),
      },
    };

    // 가장 좋은 결과 선택 (verified > partial > needs_review > suspicious)
    const rank = { verified: 4, partial: 3, needs_review: 2, suspicious: 1 };
    if (!best || rank[result.status] > rank[best.status]) {
      best = result;
    }
    if (best.status === 'verified') break;
  }

  return best;
}
