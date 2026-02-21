// ─── Hospital ────────────────────────────────────────
export interface Hospital {
  id: string;
  name: string;
  business_number: string | null;
  address: string | null;
  address_detail: string | null;
  sido: string | null;
  sigungu: string | null;
  dong: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  doctor_name: string | null;
  doctor_specialty: string | null;
  doctor_board: string | null;
  department: string | null;
  hospital_type: string | null;
  opened_at: string | null;
  source: string | null;
  crawled_at: string | null;
  verified_at: string | null;
  data_quality_score: number;
  status: string;
  is_target: boolean;
  exclude_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface HospitalEquipment {
  id: string;
  hospital_id: string;
  equipment_name: string;
  equipment_brand: string | null;
  equipment_category: string; // rf, hifu, laser, booster, body, lifting, other
  equipment_model: string | null;
  estimated_year: number | null;
  manufacturer: string | null;
  is_confirmed: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface HospitalTreatment {
  id: string;
  hospital_id: string;
  treatment_name: string;
  treatment_category: string | null;
  price_min: number | null;
  price_max: number | null;
  price: number | null;
  price_event: number | null;
  original_treatment_name: string | null;
  is_promoted: boolean;
  source: string | null;
  created_at: string;
}

export interface HospitalDoctor {
  id: string;
  hospital_id: string;
  name: string;
  title: string | null;
  specialty: string | null;
  career: string[];
  education: string[];
  source: string | null;
  created_at: string;
}

// ─── Product ────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  code: string;
  manufacturer: string;
  category: string;        // equipment, consumable, service
  subcategory: string | null;
  description: string | null;
  price_min: number | null;
  price_max: number | null;
  target_departments: string[];
  target_hospital_types: string[];
  scoring_criteria: ScoringCriteria;
  email_guide: Record<string, unknown>;
  demo_guide: Record<string, unknown> | null;
  requires_equipment_keywords: string[] | null;
  competing_keywords: string[] | null;
  synergy_keywords: string[] | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ScoringRule {
  condition: string;
  score: number;
  reason: string;
}

// v3.1 키워드 tier 구조
export const KEYWORD_TIERS = ['primary', 'secondary'] as const;
export type KeywordTier = (typeof KEYWORD_TIERS)[number];

export interface SalesKeyword {
  term: string;
  tier: KeywordTier;
  point: number;       // primary=20, secondary=10 기본
}

// v3.1 영업 각도 구조
export interface SalesAngle {
  id: string;
  name: string;
  label?: string;      // DB에서는 label로 저장됨 (name과 호환)
  weight: number;
  keywords: (SalesKeyword | string)[];  // SalesKeyword[] 신규, string[] 하위 호환
  pitch?: string;
  description?: string; // DB에서는 description으로 저장됨 (pitch와 호환)
}

export interface ComboSuggestion {
  has_equipment: string;
  torr_role: string;
  pitch: string;
}

// sales_signals 규칙 (시그널 감지용)
export interface SalesSignalRule {
  trigger: string;              // equipment_removed, equipment_added, treatment_added, price_change
  match_keywords: string[];
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title_template: string;       // "{{item_name}} 철수 감지"
  description_template: string;
  related_angle: string;        // bridge_care, mens_target 등
}

export interface ScoringCriteriaV31 {
  sales_angles: SalesAngle[];
  combo_suggestions: ComboSuggestion[];
  max_pitch_points: number;
  exclude_if: string[];
  sales_signals?: SalesSignalRule[];
}

// DEPRECATED: v3.0 구조 (need/fit/timing). 안정화 후 삭제 예정.
export interface ScoringCriteriaLegacy {
  need_rules: ScoringRule[];
  fit_rules: ScoringRule[];
  timing_rules: ScoringRule[];
}

export type ScoringCriteria = ScoringCriteriaV31 | ScoringCriteriaLegacy;

// ─── Hospital Profile (1단계 스코어링) ──────────────
export interface HospitalProfile {
  id: string;
  hospital_id: string;
  investment_score: number;
  portfolio_diversity_score: number;
  practice_scale_score: number;
  market_competition_score: number;
  marketing_activity_score: number;
  profile_score: number;
  profile_grade: string | null;   // PRIME, HIGH, MID, LOW
  ai_summary: string | null;
  main_focus: string | null;
  target_audience: string | null;
  investment_tendency: string | null;
  competitor_count: number;
  naver_review_count: number;
  analyzed_at: string;
  analysis_version: string;
}

export const PROFILE_GRADES = ['PRIME', 'HIGH', 'MID', 'LOW'] as const;
export type ProfileGrade = (typeof PROFILE_GRADES)[number];

// ─── Product Match Score (2단계 스코어링) ────────────
export interface ProductMatchScore {
  id: string;
  hospital_id: string;
  product_id: string;
  need_score: number;
  fit_score: number;
  timing_score: number;
  total_score: number;
  grade: string | null;          // S, A, B, C, EXCLUDE
  ai_selling_points: string[] | null;
  ai_risks: string[] | null;
  ai_recommended_approach: string | null;
  ai_recommended_payment: string | null;
  // v3.1 영업 각도
  sales_angle_scores: Record<string, number> | null;
  top_pitch_points: string[] | null;
  scored_at: string;
  scoring_version: string;
}

// ─── Scoring (legacy) ───────────────────────────────
export interface ScoringWeights {
  id: string;
  version: string;
  weight_equipment_synergy: number;
  weight_equipment_age: number;
  weight_revenue_impact: number;
  weight_competitive_edge: number;
  weight_purchase_readiness: number;
  criteria_details: Record<string, unknown> | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface ScoringResult {
  id: string;
  hospital_id: string;
  weight_version: string;
  score_equipment_synergy: number;
  score_equipment_age: number;
  score_revenue_impact: number;
  score_competitive_edge: number;
  score_purchase_readiness: number;
  total_score: number;
  grade: string | null;
  ai_analysis: string | null;
  ai_message_direction: string | null;
  ai_raw_response: Record<string, unknown> | null;
  scored_at: string;
}

export interface ScoringInput {
  hospital: {
    id: string;
    name: string;
    department: string;
    opened_at: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  equipments: {
    equipment_name: string;
    equipment_brand: string | null;
    equipment_category: string;
    estimated_year: number | null;
  }[];
  treatments: {
    treatment_name: string;
    treatment_category: string;
    price_min: number | null;
    price_max: number | null;
    is_promoted: boolean;
  }[];
  competitors: CompetitorData[];
}

export interface CompetitorData {
  hospital_id: string;
  name: string;
  distance_meters: number;
  hasModernRF: boolean;
  rfEquipmentName: string | null;
  treatmentCount: number;
}

export interface ScoringOutput {
  scores: {
    equipmentSynergy: number;
    equipmentAge: number;
    revenueImpact: number;
    competitiveEdge: number;
    purchaseReadiness: number;
  };
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'EXCLUDE';
}

// ─── Leads ───────────────────────────────────────────
export interface Lead {
  id: string;
  hospital_id: string;
  product_id: string | null;
  match_score_id: string | null;
  scoring_result_id: string | null;
  stage: string;
  grade: string | null;
  priority: number;
  contact_email: string | null;
  contact_name: string | null;
  contact_role: string | null;
  email_sequence_id: string | null;
  current_sequence_step: number;
  last_email_sent_at: string | null;
  last_email_opened_at: string | null;
  last_email_clicked_at: string | null;
  last_replied_at: string | null;
  kakao_connected: boolean;
  kakao_channel_user_id: string | null;
  open_count: number;
  click_count: number;
  reply_count: number;
  demo_page_visits: number;
  price_page_visits: number;
  interest_level: string;
  ai_persona_notes: string | null;
  assigned_sales_rep: string | null;
  assigned_at: string | null;
  sales_handoff_notes: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  revenue: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  activity_type: string;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  actor: string;
  created_at: string;
}

// ─── Email ───────────────────────────────────────────
export interface EmailSequence {
  id: string;
  name: string;
  target_grade: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailSequenceStep {
  id: string;
  sequence_id: string;
  step_number: number;
  delay_days: number;
  purpose: string;
  tone: string | null;
  key_message: string | null;
  personalization_focus: string | null;
  skip_if: Record<string, unknown> | null;
  upgrade_if: Record<string, unknown> | null;
  created_at: string;
}

export interface Email {
  id: string;
  lead_id: string;
  sequence_id: string | null;
  step_number: number | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  ai_prompt_used: string | null;
  ai_personalization: Record<string, unknown> | null;
  from_email: string;
  to_email: string;
  sent_at: string | null;
  status: string;
  external_id: string | null;
  created_at: string;
}

export interface EmailEvent {
  id: string;
  email_id: string;
  lead_id: string;
  event_type: string;
  clicked_url: string | null;
  clicked_page: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── Demo ────────────────────────────────────────────
export interface Demo {
  id: string;
  lead_id: string;
  hospital_id: string;
  demo_type: string;
  requested_at: string;
  scheduled_at: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  prep_scoring_summary: string | null;
  prep_roi_simulation: Record<string, unknown> | null;
  prep_combo_suggestion: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoEvaluation {
  id: string;
  demo_id: string;
  lead_id: string;
  satisfaction_score: number | null;
  purchase_intent: string | null;
  preferred_payment: string | null;
  additional_questions: string | null;
  feedback: string | null;
  evaluated_at: string;
}

// ─── Kakao & Commission ─────────────────────────────
export interface KakaoMessage {
  id: string;
  lead_id: string;
  message_type: string;
  template_code: string | null;
  content: string;
  direction: string;
  status: string;
  external_id: string | null;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Commission {
  id: string;
  lead_id: string;
  deal_amount: number;
  manufacturing_cost: number | null;
  company_margin: number | null;
  sales_commission: number | null;
  madmedsales_share_pct: number;
  dealer_share_pct: number;
  madmedsales_amount: number | null;
  dealer_amount: number | null;
  dealer_name: string | null;
  status: string;
  closed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface Unsubscribe {
  id: string;
  email: string;
  hospital_id: string | null;
  reason: string | null;
  unsubscribed_at: string;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}
