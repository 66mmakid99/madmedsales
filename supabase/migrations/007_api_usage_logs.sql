-- 007: API Usage Logs for cost tracking
-- Tracks token usage and estimated costs for all AI API calls

CREATE TABLE api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,        -- 'gemini' | 'claude'
  model TEXT NOT NULL,          -- 'gemini-2.0-flash' | 'claude-haiku-4-5' | 'claude-sonnet-4-5'
  purpose TEXT NOT NULL,        -- 'web_analysis' | 'scoring' | 'email_generation' | 'reply_analysis' | 'tone_adapt'
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  estimated_cost_usd DECIMAL(10, 6),
  hospital_id UUID REFERENCES hospitals(id),
  lead_id UUID REFERENCES leads(id),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_service ON api_usage_logs(service);
CREATE INDEX idx_usage_purpose ON api_usage_logs(purpose);
CREATE INDEX idx_usage_created ON api_usage_logs(created_at DESC);
CREATE INDEX idx_usage_hospital ON api_usage_logs(hospital_id);
