import {
  ExcelRow, HospitalRecord, MatchResult, MatchCandidate, MatchOptions,
} from './types.js';
import {
  normalizeHospitalName, normalizeDoctorName,
  extractSido, extractSigungu,
} from './normalizer.js';

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export class MatchingEngine {
  private hospitals: HospitalRecord[];
  private nameIndex: Map<string, HospitalRecord[]>;

  constructor(hospitals: HospitalRecord[]) {
    this.hospitals = hospitals;
    this.nameIndex = new Map();
    for (const h of hospitals) {
      const key = h.normalizedName;
      if (!this.nameIndex.has(key)) this.nameIndex.set(key, []);
      this.nameIndex.get(key)!.push(h);
    }
  }

  match(row: ExcelRow, options: MatchOptions): MatchResult {
    const normalizedInput  = normalizeHospitalName(row.rawHospitalName);
    const normalizedDoctor = normalizeDoctorName(row.rawDoctorName);
    const inputSido        = extractSido(row.rawAddress);
    const inputSigungu     = extractSigungu(row.rawAddress);

    // ─── 1단계: Exact Match ───────────────────────────
    const exactCandidates = this.nameIndex.get(normalizedInput) ?? [];

    if (exactCandidates.length === 1) {
      return { excelRow: row, matchType: 'exact', score: 1.0, matched: exactCandidates[0], candidates: [] };
    }

    if (exactCandidates.length > 1) {
      const resolved = this.tiebreak(exactCandidates, normalizedDoctor, inputSido, inputSigungu);
      if (resolved) {
        return { excelRow: row, matchType: 'exact', score: 1.0, matched: resolved, candidates: [] };
      }
      return {
        excelRow: row, matchType: 'ambiguous', score: 1.0, matched: null,
        candidates: exactCandidates.map(h => ({ hospital: h, score: 1.0, nameScore: 1.0, doctorBonus: 0, addressBonus: 0 })),
      };
    }

    // ─── 2단계: Fuzzy Match ───────────────────────────
    const candidates: MatchCandidate[] = [];

    for (const h of this.hospitals) {
      if (options.sido && h.sido && !h.sido.startsWith(options.sido)) continue;

      const nameScore = similarity(normalizedInput, h.normalizedName);
      if (nameScore < options.fuzzyThreshold) continue;

      let doctorBonus = 0;
      let addressBonus = 0;

      if (normalizedDoctor && h.normalizedDoctorName) {
        if (similarity(normalizedDoctor, h.normalizedDoctorName) >= 0.9) doctorBonus = 0.05;
      }
      if (inputSido && h.sido?.startsWith(inputSido)) {
        addressBonus += 0.02;
        if (inputSigungu && h.sigungu === inputSigungu) addressBonus += 0.02;
      }

      candidates.push({ hospital: h, score: nameScore + doctorBonus + addressBonus, nameScore, doctorBonus, addressBonus });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { excelRow: row, matchType: 'unmatched', score: 0, matched: null, candidates: [] };
    }

    const top    = candidates[0];
    const second = candidates[1];

    // 상위 2개가 너무 가까우면 ambiguous
    if (second && top.score - second.score < 0.03 && top.nameScore < 0.95) {
      return { excelRow: row, matchType: 'ambiguous', score: top.score, matched: null, candidates: candidates.slice(0, 5) };
    }

    return { excelRow: row, matchType: 'fuzzy', score: top.score, matched: top.hospital, candidates: [] };
  }

  private tiebreak(
    candidates: HospitalRecord[],
    normalizedDoctor: string,
    inputSido: string,
    inputSigungu: string,
  ): HospitalRecord | null {
    if (normalizedDoctor) {
      const doctorMatch = candidates.filter(h =>
        h.normalizedDoctorName && similarity(normalizedDoctor, h.normalizedDoctorName) >= 0.9
      );
      if (doctorMatch.length === 1) return doctorMatch[0];
    }
    if (inputSigungu) {
      const areaMatch = candidates.filter(h => h.sigungu === inputSigungu);
      if (areaMatch.length === 1) return areaMatch[0];
    }
    if (inputSido) {
      const sidoMatch = candidates.filter(h => h.sido?.startsWith(inputSido));
      if (sidoMatch.length === 1) return sidoMatch[0];
    }
    return null;
  }
}
