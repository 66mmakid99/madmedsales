CREATE TABLE hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_number TEXT UNIQUE,
  address TEXT, address_detail TEXT,
  sido TEXT, sigungu TEXT, dong TEXT,
  latitude DECIMAL(10, 7), longitude DECIMAL(10, 7),
  phone TEXT, email TEXT, website TEXT,
  doctor_name TEXT, doctor_specialty TEXT,
  doctor_board TEXT, department TEXT,
  hospital_type TEXT,
  opened_at DATE,
  source TEXT, crawled_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
  data_quality_score INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  is_target BOOLEAN DEFAULT true, exclude_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_hospitals_location ON hospitals(sido, sigungu);
CREATE INDEX idx_hospitals_department ON hospitals(department);
CREATE INDEX idx_hospitals_status ON hospitals(status);

CREATE TABLE hospital_equipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  equipment_name TEXT NOT NULL,
  equipment_brand TEXT,
  equipment_category TEXT NOT NULL,  -- rf, laser, ultrasound, ipl, other
  equipment_model TEXT,
  estimated_year INT,
  is_confirmed BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_equip_hospital ON hospital_equipments(hospital_id);
CREATE INDEX idx_equip_category ON hospital_equipments(equipment_category);

CREATE TABLE hospital_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  treatment_name TEXT NOT NULL,
  treatment_category TEXT,  -- lifting, tightening, toning, filler, botox, etc
  price_min INT, price_max INT,
  is_promoted BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_treat_hospital ON hospital_treatments(hospital_id);
CREATE INDEX idx_treat_category ON hospital_treatments(treatment_category);
CREATE TABLE scoring_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  weight_equipment_synergy INT DEFAULT 25,
  weight_equipment_age INT DEFAULT 20,
  weight_revenue_impact INT DEFAULT 30,
  weight_competitive_edge INT DEFAULT 15,
  weight_purchase_readiness INT DEFAULT 10,
  criteria_details JSONB,
  is_active BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO scoring_weights (version, is_active, notes)
VALUES ('v1.0', true, '초기 버전');

CREATE TABLE scoring_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  weight_version TEXT NOT NULL,
  score_equipment_synergy INT DEFAULT 0,
  score_equipment_age INT DEFAULT 0,
  score_revenue_impact INT DEFAULT 0,
  score_competitive_edge INT DEFAULT 0,
  score_purchase_readiness INT DEFAULT 0,
  total_score INT DEFAULT 0,
  grade TEXT, -- S, A, B, C, EXCLUDE
  ai_analysis TEXT,
  ai_message_direction TEXT,
  ai_raw_response JSONB,
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hospital_id, weight_version)
);
CREATE INDEX idx_scoring_hospital ON scoring_results(hospital_id);
CREATE INDEX idx_scoring_grade ON scoring_results(grade);
CREATE INDEX idx_scoring_total ON scoring_results(total_score DESC);
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  scoring_result_id UUID REFERENCES scoring_results(id),
  stage TEXT DEFAULT 'new',
  -- new → contacted → responded → kakao_connected → demo_scheduled
  -- → demo_done → proposal → negotiation → closed_won → closed_lost → nurturing
  grade TEXT,
  priority INT DEFAULT 0,
  contact_email TEXT, contact_name TEXT, contact_role TEXT,
  email_sequence_id UUID,
  current_sequence_step INT DEFAULT 0,
  last_email_sent_at TIMESTAMPTZ,
  last_email_opened_at TIMESTAMPTZ,
  last_email_clicked_at TIMESTAMPTZ,
  last_replied_at TIMESTAMPTZ,
  kakao_connected BOOLEAN DEFAULT false,
  kakao_channel_user_id TEXT,
  open_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  reply_count INT DEFAULT 0,
  demo_page_visits INT DEFAULT 0,
  price_page_visits INT DEFAULT 0,
  interest_level TEXT DEFAULT 'unknown',  -- cold, warming, warm, hot
  ai_persona_notes TEXT,
  assigned_sales_rep TEXT,
  assigned_at TIMESTAMPTZ,
  sales_handoff_notes TEXT,
  won_at TIMESTAMPTZ, lost_at TIMESTAMPTZ, lost_reason TEXT,
  revenue DECIMAL(12, 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_leads_hospital ON leads(hospital_id);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_grade ON leads(grade);
CREATE INDEX idx_leads_interest ON leads(interest_level);

CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  -- email_sent, email_opened, email_clicked, email_replied,
  -- email_bounced, email_unsubscribed,
  -- kakao_connected, kakao_sent, kakao_replied,
  -- demo_requested, demo_completed, demo_evaluated,
  -- page_visited, stage_changed, note_added,
  -- sales_assigned, ai_analysis
  title TEXT, description TEXT, metadata JSONB,
  actor TEXT DEFAULT 'system', -- system, ai, admin, sales_rep
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activities_lead ON lead_activities(lead_id);
CREATE INDEX idx_activities_type ON lead_activities(activity_type);
CREATE INDEX idx_activities_created ON lead_activities(created_at DESC);
CREATE TABLE email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_grade TEXT NOT NULL, -- S, A, B, C
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  delay_days INT NOT NULL,
  purpose TEXT NOT NULL, -- intro, case_study, competition, price_offer, final_followup
  tone TEXT, -- professional, friendly, consulting, casual
  key_message TEXT,
  personalization_focus TEXT, -- equipment, revenue, competition, price
  skip_if JSONB, upgrade_if JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_steps_sequence ON email_sequence_steps(sequence_id, step_number);

CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  sequence_id UUID REFERENCES email_sequences(id),
  step_number INT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  ai_prompt_used TEXT,
  ai_personalization JSONB,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'queued', -- queued, sent, delivered, bounced, failed
  external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_emails_lead ON emails(lead_id);
CREATE INDEX idx_emails_status ON emails(status);
CREATE INDEX idx_emails_sent ON emails(sent_at DESC);

CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id),
  event_type TEXT NOT NULL, -- delivered, opened, clicked, bounced, complained, unsubscribed
  clicked_url TEXT,
  clicked_page TEXT, -- demo, pricing, product, resource
  ip_address TEXT, user_agent TEXT, metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_events_email ON email_events(email_id);
CREATE INDEX idx_events_lead ON email_events(lead_id);
CREATE INDEX idx_events_type ON email_events(event_type);
CREATE TABLE demos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  demo_type TEXT NOT NULL, -- online, visit, self_video
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  assigned_to TEXT,
  prep_scoring_summary TEXT,
  prep_roi_simulation JSONB,
  prep_combo_suggestion TEXT,
  status TEXT DEFAULT 'requested',
  -- requested → confirmed → preparing → in_progress → completed → evaluated → cancelled
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_demos_lead ON demos(lead_id);
CREATE INDEX idx_demos_status ON demos(status);
CREATE INDEX idx_demos_scheduled ON demos(scheduled_at);

CREATE TABLE demo_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id),
  satisfaction_score INT, -- 1~5
  purchase_intent TEXT, -- immediate, considering, hold, no_interest
  preferred_payment TEXT, -- lump_sum, installment, rental, capital
  additional_questions TEXT, feedback TEXT,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE kakao_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  message_type TEXT NOT NULL, -- alimtalk, friendtalk, chat
  template_code TEXT,
  content TEXT NOT NULL,
  direction TEXT NOT NULL, -- outbound, inbound
  status TEXT DEFAULT 'queued', -- queued, sent, delivered, read, failed
  external_id TEXT, sent_at TIMESTAMPTZ, read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_kakao_lead ON kakao_messages(lead_id);

CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  deal_amount DECIMAL(12, 0) NOT NULL,
  manufacturing_cost DECIMAL(12, 0),
  company_margin DECIMAL(12, 0),
  sales_commission DECIMAL(12, 0),
  madmedsales_share_pct INT DEFAULT 50,
  dealer_share_pct INT DEFAULT 50,
  madmedsales_amount DECIMAL(12, 0),
  dealer_amount DECIMAL(12, 0),
  dealer_name TEXT,
  status TEXT DEFAULT 'pending', -- pending, confirmed, paid
  closed_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_comm_lead ON commissions(lead_id);
CREATE INDEX idx_comm_status ON commissions(status);

CREATE TABLE unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  hospital_id UUID REFERENCES hospitals(id),
  reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_unsub_email ON unsubscribes(email);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO system_settings (key, value, description) VALUES
('email_daily_limit', '50', '일일 이메일 발송 제한'),
('email_warmup_phase', 'true', '도메인 웜업 모드'),
('email_send_hours', '{"start": 12, "end": 19}', '발송 허용 시간대 (점심~저녁)'),
('scoring_active_version', '"v1.0"', '현재 적용 스코어링 버전'),
('torr_rf_price_min', '25000000', 'TORR RF 최소 가격'),
('torr_rf_price_max', '28000000', 'TORR RF 최대 가격'),
('commission_default_split', '{"madmedsales": 50, "dealer": 50}', '기본 수수료 분배'),
('sequence_pause_on_reply', 'true', '회신 시 시퀀스 일시정지');
