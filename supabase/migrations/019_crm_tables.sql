-- 019_crm_tables.sql
-- CRM Phase 1: 멀티테넌트 CRM 테이블 12개 생성

-- ===== 1. tenants =====
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  logo_url TEXT,
  plan TEXT NOT NULL DEFAULT 'basic',
  admin_name TEXT,
  admin_email TEXT,
  admin_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_tenant_plan CHECK (plan IN ('basic', 'pro', 'enterprise'))
);

-- ===== 2. users =====
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_user_role CHECK (role IN ('admin', 'manager', 'member'))
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ===== 3. crm_franchises =====
CREATE TABLE IF NOT EXISTS crm_franchises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_branches INTEGER,
  equipped_branches INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_franchises_tenant ON crm_franchises(tenant_id);

-- ===== 4. crm_products =====
CREATE TABLE IF NOT EXISTS crm_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model_variants TEXT[],
  price_range TEXT,
  warranty_months INTEGER NOT NULL DEFAULT 24,
  consumables JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_products_tenant ON crm_products(tenant_id);

-- ===== 5. crm_hospitals =====
CREATE TABLE IF NOT EXISTS crm_hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  branch_name TEXT,
  address TEXT,
  region TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  kakao_channel TEXT,

  customer_grade TEXT NOT NULL DEFAULT 'B',
  health_status TEXT NOT NULL DEFAULT 'green',
  franchise_id UUID REFERENCES crm_franchises(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,

  report_enabled BOOLEAN NOT NULL DEFAULT true,
  report_tier TEXT NOT NULL DEFAULT 'lite',

  hospital_ref_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,

  tags TEXT[],
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_customer_grade CHECK (customer_grade IN ('VIP', 'A', 'B', 'C')),
  CONSTRAINT chk_health_status CHECK (health_status IN ('green', 'yellow', 'orange', 'red')),
  CONSTRAINT chk_report_tier CHECK (report_tier IN ('lite', 'pro'))
);

CREATE INDEX IF NOT EXISTS idx_crm_hospitals_tenant ON crm_hospitals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_hospitals_franchise ON crm_hospitals(franchise_id);
CREATE INDEX IF NOT EXISTS idx_crm_hospitals_assigned ON crm_hospitals(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_hospitals_grade ON crm_hospitals(tenant_id, customer_grade);
CREATE INDEX IF NOT EXISTS idx_crm_hospitals_health ON crm_hospitals(tenant_id, health_status);

-- ===== 6. crm_contacts =====
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES crm_hospitals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  phone TEXT,
  email TEXT,
  kakao_id TEXT,
  interests TEXT[],
  personality_notes TEXT,
  preferred_contact TEXT NOT NULL DEFAULT 'kakao',
  birthday DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_preferred_contact CHECK (preferred_contact IN ('kakao', 'phone', 'email', 'visit'))
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_hospital ON crm_contacts(hospital_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant ON crm_contacts(tenant_id);

-- ===== 7. crm_equipment =====
CREATE TABLE IF NOT EXISTS crm_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES crm_hospitals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES crm_products(id) ON DELETE SET NULL,
  serial_number TEXT,
  model_variant TEXT,
  delivered_at DATE,
  warranty_end DATE,
  firmware_version TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  condition TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_equipment_status CHECK (status IN ('active', 'inactive', 'maintenance', 'sold', 'disposed')),
  CONSTRAINT chk_equipment_condition CHECK (condition IN ('new', 'used'))
);

CREATE INDEX IF NOT EXISTS idx_crm_equipment_hospital ON crm_equipment(hospital_id);
CREATE INDEX IF NOT EXISTS idx_crm_equipment_product ON crm_equipment(product_id);

-- ===== 8. crm_consumable_orders =====
CREATE TABLE IF NOT EXISTS crm_consumable_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES crm_hospitals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_date DATE NOT NULL,
  items JSONB NOT NULL,
  total_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'ordered',
  tracking_number TEXT,
  delivered_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_order_status CHECK (status IN ('ordered', 'shipped', 'delivered', 'cancelled'))
);

-- ===== 9. crm_activities =====
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES crm_hospitals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  direction TEXT,
  subject TEXT,
  content TEXT,
  email_opened BOOLEAN,
  email_clicked BOOLEAN,
  attachments TEXT[],
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_activity_type CHECK (type IN ('visit', 'call', 'email', 'message', 'order', 'service', 'training', 'report')),
  CONSTRAINT chk_activity_direction CHECK (direction IS NULL OR direction IN ('inbound', 'outbound'))
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_hospital ON crm_activities(hospital_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_tenant ON crm_activities(tenant_id);

-- ===== 10. crm_tasks =====
CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES crm_hospitals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES crm_activities(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_task_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT chk_task_status CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant ON crm_tasks(tenant_id);

-- ===== 11. crm_hospital_reports =====
CREATE TABLE IF NOT EXISTS crm_hospital_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES crm_hospitals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_month TEXT NOT NULL,

  ad_violation_count INTEGER NOT NULL DEFAULT 0,
  ad_violations JSONB,
  ad_score INTEGER,

  aeo_total_score INTEGER,
  aeo_structure INTEGER,
  aeo_content INTEGER,
  aeo_technical INTEGER,
  aeo_trust INTEGER,
  aeo_grade TEXT,
  aeo_ai_mentions JSONB,

  naver_blog_count INTEGER,
  naver_place_rating DECIMAL(2,1),
  naver_review_count INTEGER,
  naver_search_rank INTEGER,
  naver_marketing_score INTEGER,

  overall_health TEXT,
  recommendations JSONB,

  prev_ad_score INTEGER,
  prev_aeo_score INTEGER,
  prev_naver_score INTEGER,

  email_sent_at TIMESTAMPTZ,
  email_opened_at TIMESTAMPTZ,
  email_clicked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_reports_hospital_month ON crm_hospital_reports(hospital_id, report_month);
CREATE INDEX IF NOT EXISTS idx_crm_reports_tenant ON crm_hospital_reports(tenant_id);

-- ===== 12. crm_templates =====
CREATE TABLE IF NOT EXISTS crm_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  trigger_type TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  send_delay_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_template_channel CHECK (channel IN ('email', 'kakao', 'sms'))
);

CREATE INDEX IF NOT EXISTS idx_crm_templates_tenant ON crm_templates(tenant_id);

-- ===== updated_at 자동 갱신 트리거 =====
CREATE OR REPLACE FUNCTION crm_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_franchises_updated_at BEFORE UPDATE ON crm_franchises
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_products_updated_at BEFORE UPDATE ON crm_products
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_hospitals_updated_at BEFORE UPDATE ON crm_hospitals
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_contacts_updated_at BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_equipment_updated_at BEFORE UPDATE ON crm_equipment
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_consumable_orders_updated_at BEFORE UPDATE ON crm_consumable_orders
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_tasks_updated_at BEFORE UPDATE ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();

CREATE TRIGGER trg_crm_templates_updated_at BEFORE UPDATE ON crm_templates
  FOR EACH ROW EXECUTE FUNCTION crm_update_timestamp();
