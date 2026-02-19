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
