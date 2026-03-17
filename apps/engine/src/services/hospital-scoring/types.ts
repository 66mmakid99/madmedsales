// ─── Hospital Data Bundle ─────────────────────────────────────
export interface SnapshotData {
  equipments_found: string[];
  treatments_found: string[];
  pricing_found: string[];
}

export interface EquipmentMasterEntry {
  canonical_name: string;
  category: string;
  equipment_type: string;
}

export interface SessionData {
  total_urls: number;
  crawled_pages: number;
}

export interface PageCounts {
  event: number;
  blog: number;
  price: number;
  treatment: number;
  total: number;
}

export interface HospitalDataBundle {
  hospitalId: string;
  snapshot: SnapshotData | null;
  doctorCount: number;
  equipment: EquipmentMasterEntry[];
  session: SessionData | null;
  pages: PageCounts;
}

// ─── Scoring Results ──────────────────────────────────────────
export interface ProfilerScores {
  investment: number;
  portfolio: number;
  scale: number;
  marketing: number;
  total: number;
}

export interface TorrScores {
  bridge: number;
  postop: number;
  mens: number;
  painless: number;
  body: number;
  total: number;
}

export interface ScoringResult {
  hospitalId: string;
  profiler: ProfilerScores;
  torr: TorrScores;
  finalScore: number;
  dataCompleteness: number;
  details: ScoringDetails;
}

export interface ScoringDetails {
  investmentDetails: string[];
  portfolioDetails: string[];
  scaleDetails: string[];
  marketingDetails: string[];
  torrDetails: Record<string, string[]>;
}

// ─── Bulk Data Maps ───────────────────────────────────────────
export interface BulkDataMaps {
  snapshots: Map<string, SnapshotData>;
  doctorCounts: Map<string, number>;
  equipmentMaster: Map<string, EquipmentMasterEntry[]>;
  sessions: Map<string, SessionData>;
  pageCounts: Map<string, PageCounts>;
  allHospitalIds: Set<string>;
}

// ─── Keyword Constants ────────────────────────────────────────
export const RF_EQUIPMENT_KEYWORDS = [
  '써마지', '인모드', '포텐자', '올리지오', '시크릿', '인피니',
  '토르RF', 'TORR', '써마지FLX', '리니어지', '리주란',
  'thermage', 'inmode', 'potenza', 'oligio', 'secret', 'infini',
  'morpheus', '모피어스', '에이전', 'agnes', '스카렛', 'scarlet',
];

export const LIFTING_KEYWORDS = [
  '울쎄라', '써마지', '실리프팅', 'HIFU', '하이푸', '울트라포머',
  '더블로', '소노퀸', '리프테라', '슈링크', '유니버스',
  'ulthera', 'ultraformer', 'doublo', 'shrink',
  '리프팅', '타이트닝', '인모드', '올리지오',
];

export const PREMIUM_TREATMENT_KEYWORDS = [
  '줄기세포', '엑소좀', 'PRP', 'PDRN', '리주란', '쥬베룩',
  '볼루마', '레스틸렌', '필러', '보톡스', '제오민',
  '프로파일로', '리쥬란HB', '스킨보톡스',
  'rejuran', 'juvelook', 'profhilo', 'voluma',
];

export const BRIDGE_KEYWORDS = [
  ...LIFTING_KEYWORDS,
  '피부탄력', '콜라겐', '레이저리프팅', '고주파', 'RF리프팅',
];

export const POSTOP_KEYWORDS = [
  '레이저토닝', '피코레이저', '프락셀', '프락셔널',
  '회복', '재생', '진정', 'LED', '엘이디', '힐라이트',
  '리쥬란', '연어주사', '성장인자', 'EGF',
  'pico', 'fractional', 'fraxel', 'healite',
];

export const MENS_KEYWORDS = [
  '남성', '탈모', '두피', '모발이식', '헤어라인',
  '남자', '수염', 'FUE', 'FUT', '미녹시딜',
  '남성피부', '남성탈모', '두피관리',
];

export const PAINLESS_KEYWORDS = [
  '무통', '저통', '편안한', '통증없는', '무통증',
  '수면마취', '크림마취', '무감각', '통증최소화',
  'painless', 'comfortable', '슬립마취',
];

export const BODY_KEYWORDS = [
  '바디', '타이트닝', '컨투어링', '셀룰라이트', '지방분해',
  '인모드바디', '바디FX', '엔더몰로지', '이중턱',
  '팔뚝', '복부', '허벅지', '체형', '슬리밍',
  'body', 'contouring', 'bodyfx', 'endermologie',
];
