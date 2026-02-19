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
