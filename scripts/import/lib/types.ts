export interface ExcelRow {
  rawHospitalName: string;
  rawDoctorName: string;
  email: string;
  rawAddress: string;
  rowIndex: number;
}

export interface HospitalRecord {
  id: string;
  name: string;
  normalizedName: string;
  email: string | null;
  doctorName: string | null;
  normalizedDoctorName: string | null;
  address: string | null;
  sido: string | null;
  sigungu: string | null;
}

export type MatchType = 'exact' | 'fuzzy' | 'ambiguous' | 'unmatched';

export interface MatchCandidate {
  hospital: HospitalRecord;
  score: number;
  nameScore: number;
  doctorBonus: number;
  addressBonus: number;
}

export interface MatchResult {
  excelRow: ExcelRow;
  matchType: MatchType;
  score: number;
  matched: HospitalRecord | null;
  candidates: MatchCandidate[];
}

export type UpdateAction =
  | 'updated'
  | 'skipped_existing'
  | 'skipped_invalid_email'
  | 'no_match';

export interface ReportRow {
  rowIndex: number;
  excelHospitalName: string;
  excelDoctorName: string;
  excelEmail: string;
  excelAddress: string;
  matchType: MatchType;
  matchScore: number;
  matchedHospitalId: string;
  matchedHospitalName: string;
  matchedDoctorName: string;
  action: UpdateAction;
  previousEmail: string;
  candidateCount: number;
}

export interface MatchOptions {
  dryRun: boolean;
  overwrite: boolean;
  fuzzyThreshold: number;
  sido: string | null;
  dept: string | null;
  batchSize: number;
}
