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
