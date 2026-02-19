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
