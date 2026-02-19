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
