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
  equipment_category: string; // rf, laser, ultrasound, ipl, other
  equipment_model: string | null;
  estimated_year: number | null;
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
  is_promoted: boolean;
  source: string | null;
  created_at: string;
}

// ─── Scoring ─────────────────────────────────────────
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
