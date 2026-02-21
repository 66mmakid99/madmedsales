-- 017: 키워드 tier/point 구조 + sales_signals 규칙 + equipment_changes/sales_signals 테이블
-- v3.1.1 - 2026-02-21

-- ═══════════════════════════════════════════════════════
-- A-2: TORR RF scoring_criteria keywords를 tier/point 구조로 업데이트
-- A-2-b: sales_signals 규칙 추가
-- ═══════════════════════════════════════════════════════

UPDATE products
SET scoring_criteria = '{
  "sales_angles": [
    {
      "id": "bridge_care",
      "label": "시술 브릿지 케어",
      "weight": 45,
      "keywords": [
        {"term": "써마지", "tier": "primary", "point": 20},
        {"term": "울쎄라", "tier": "primary", "point": 20},
        {"term": "실리프팅", "tier": "secondary", "point": 10},
        {"term": "민트실", "tier": "secondary", "point": 10},
        {"term": "안면거상", "tier": "secondary", "point": 10},
        {"term": "아이써마지", "tier": "secondary", "point": 10}
      ],
      "description": "고주파 시술 후 사후관리·브릿지 프로토콜"
    },
    {
      "id": "post_op_care",
      "label": "수술 후 회복 관리",
      "weight": 25,
      "keywords": [
        {"term": "안면거상", "tier": "primary", "point": 20},
        {"term": "지방흡입", "tier": "primary", "point": 20},
        {"term": "이물질 제거", "tier": "secondary", "point": 10},
        {"term": "붓기 관리", "tier": "secondary", "point": 10},
        {"term": "사후관리", "tier": "secondary", "point": 10},
        {"term": "거상술", "tier": "secondary", "point": 10}
      ],
      "description": "수술 후 부종·회복 가속 프로토콜"
    },
    {
      "id": "mens_target",
      "label": "남성 타겟",
      "weight": 15,
      "keywords": [
        {"term": "남성 피부관리", "tier": "primary", "point": 20},
        {"term": "맨즈 안티에이징", "tier": "primary", "point": 20},
        {"term": "남성 리프팅", "tier": "secondary", "point": 10},
        {"term": "제모", "tier": "secondary", "point": 10},
        {"term": "옴므", "tier": "secondary", "point": 10},
        {"term": "포맨", "tier": "secondary", "point": 10},
        {"term": "남성 전용", "tier": "secondary", "point": 10}
      ],
      "description": "남성 전용 메뉴 보유 여부"
    },
    {
      "id": "painless_focus",
      "label": "무통·편의 지향",
      "weight": 10,
      "keywords": [
        {"term": "무마취", "tier": "primary", "point": 20},
        {"term": "무통증 리프팅", "tier": "primary", "point": 20},
        {"term": "직장인 점심시간", "tier": "secondary", "point": 10},
        {"term": "논다운타임", "tier": "secondary", "point": 10},
        {"term": "수면마취 없는", "tier": "secondary", "point": 10},
        {"term": "무통", "tier": "secondary", "point": 10}
      ],
      "description": "무통/편의 지향 시술 운영"
    },
    {
      "id": "combo_body",
      "label": "바디 콤보",
      "weight": 5,
      "keywords": [
        {"term": "슈링크", "tier": "primary", "point": 20},
        {"term": "HIFU", "tier": "primary", "point": 20},
        {"term": "눈가 주름", "tier": "secondary", "point": 10},
        {"term": "셀룰라이트", "tier": "secondary", "point": 10},
        {"term": "바디 타이트닝", "tier": "secondary", "point": 10},
        {"term": "이중턱", "tier": "secondary", "point": 10}
      ],
      "description": "바디 시술 라인업 보유"
    }
  ],
  "sales_signals": [
    {
      "trigger": "equipment_removed",
      "match_keywords": ["써마지", "울쎄라", "인모드", "슈링크"],
      "priority": "HIGH",
      "title_template": "{{item_name}} 철수 감지",
      "description_template": "고가 장비 이탈 → 브릿지 케어 공백, 토르RF 대안 제안 적기",
      "related_angle": "bridge_care"
    },
    {
      "trigger": "treatment_added",
      "match_keywords": ["남성", "맨즈", "옴므", "포맨"],
      "priority": "MEDIUM",
      "title_template": "남성 시술 신규 개설",
      "description_template": "남성 고객 확장 중 → 무마취 토르 리프팅 제안 적기",
      "related_angle": "mens_target"
    },
    {
      "trigger": "equipment_added",
      "match_keywords": ["안면거상", "지방흡입", "거상술"],
      "priority": "MEDIUM",
      "title_template": "수술 라인업 확장 감지",
      "description_template": "수술 후 관리 수요 증가 → 토르RF 사후관리 제안",
      "related_angle": "post_op_care"
    },
    {
      "trigger": "equipment_removed",
      "match_keywords": ["토르", "TORR"],
      "priority": "LOW",
      "title_template": "토르RF 보유 확인 해제",
      "description_template": "기존 토르RF 사용 병원에서 장비 미감지 — 리스 종료 또는 데이터 오류 확인 필요",
      "related_angle": "exclude"
    }
  ],
  "combo_suggestions": [],
  "max_pitch_points": 2,
  "exclude_if": ["has_torr_rf"]
}'::jsonb,
updated_at = NOW()
WHERE name = 'TORR RF';

-- ═══════════════════════════════════════════════════════
-- A-3: equipment_changes 테이블
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equipment_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  change_type VARCHAR(20) NOT NULL,       -- ADDED / REMOVED
  item_type VARCHAR(20) NOT NULL,         -- EQUIPMENT / TREATMENT
  item_name TEXT NOT NULL,                -- 원본 이름
  standard_name VARCHAR(100),             -- 표준명
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_snapshot_id UUID REFERENCES crawl_snapshots(id),
  curr_snapshot_id UUID REFERENCES crawl_snapshots(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_changes_hospital_detected
  ON equipment_changes(hospital_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_changes_standard_name
  ON equipment_changes(standard_name);

-- ═══════════════════════════════════════════════════════
-- A-3: sales_signals 테이블
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sales_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  product_id UUID NOT NULL REFERENCES products(id),
  signal_type VARCHAR(50) NOT NULL,       -- EQUIPMENT_REMOVED / EQUIPMENT_ADDED / TREATMENT_ADDED / PRICE_CHANGE
  priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',  -- HIGH / MEDIUM / LOW
  title TEXT NOT NULL,
  description TEXT,
  related_angle VARCHAR(50),              -- bridge_care, mens_target 등
  source_change_id UUID REFERENCES equipment_changes(id),
  status VARCHAR(20) NOT NULL DEFAULT 'NEW',  -- NEW / CONTACTED / DISMISSED
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_signals_hospital
  ON sales_signals(hospital_id);
CREATE INDEX IF NOT EXISTS idx_sales_signals_status_priority
  ON sales_signals(status, priority);
CREATE INDEX IF NOT EXISTS idx_sales_signals_detected
  ON sales_signals(detected_at DESC);
