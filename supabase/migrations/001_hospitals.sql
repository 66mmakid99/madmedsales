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
