-- ============================================================
-- Migration 014: 사전 데이터 시딩
-- keyword_dictionary 15+건, compound_words 8+건
-- claude-code-migration-plan.md 1-3절 참조
-- ============================================================

-- keyword_dictionary 시딩 (15건)
INSERT INTO keyword_dictionary (standard_name, category, aliases, base_unit_type) VALUES
('울쎄라', 'hifu', '["울세라","ulthera","울쎄","울","울쎄라더블로"]'::jsonb, 'SHOT'),
('슈링크', 'hifu', '["슈링크유니버스","shurink","슈","슈링크U"]'::jsonb, 'SHOT'),
('온다리프팅', 'hifu', '["온다","onda","온다리프팅"]'::jsonb, 'JOULE'),
('써마지', 'rf', '["써마지FLX","써마지CPT","thermage","써마","써"]'::jsonb, 'SHOT'),
('인모드', 'rf', '["인모드FX","인모드FORMA","inmode","인모드리프팅"]'::jsonb, 'SESSION'),
('올리지오', 'rf', '["올리지오X","올리","oligio"]'::jsonb, 'SESSION'),
('포텐자', 'rf', '["포텐","potenza","포텐자MRF"]'::jsonb, 'SESSION'),
('토르RF', 'rf', '["토르","TORR","TORR RF","토르리프팅"]'::jsonb, 'SESSION'),
('쥬베룩', 'booster', '["쥬베룩볼륨","쥬베","juvelook","쥬베룩비타"]'::jsonb, 'CC'),
('리쥬란', 'booster', '["리쥬란힐러","리쥬란HB","리쥬","rejuran"]'::jsonb, 'CC'),
('실리프팅', 'lifting', '["민트실","실루엣소프트","캐번실","잼버실","녹는실","코그실","실톡스"]'::jsonb, 'LINE'),
('안면거상', 'surgery', '["미니거상","거상술","페이스리프트","풀페이스리프트"]'::jsonb, 'SESSION'),
('지방흡입', 'surgery', '["지흡","얼굴지흡","이중턱지흡","턱지흡","바디지흡"]'::jsonb, 'SESSION'),
('보톡스', 'toxin', '["보톡","botox","보툴리눔","제오민","나보타","보툴렉스"]'::jsonb, 'UNIT'),
('필러', 'filler', '["주름필러","볼필러","턱필러","이마필러","코필러"]'::jsonb, 'CC')
ON CONFLICT DO NOTHING;

-- compound_words 시딩 (8건)
INSERT INTO compound_words (compound_name, decomposed_names, scoring_note) VALUES
('울써마지', '["울쎄라","써마지"]'::jsonb, '고가 브릿지, 프리미엄 패키지'),
('인슈링크', '["인모드","슈링크"]'::jsonb, 'RF+HIFU 컴바인'),
('울쥬베', '["울쎄라","쥬베룩"]'::jsonb, '리프팅+부스터 패키지'),
('써쥬베', '["써마지","쥬베룩"]'::jsonb, 'RF+부스터 패키지'),
('텐텐', '["텐쎄라","텐써마"]'::jsonb, '아이리프팅 특화'),
('올리쥬란', '["올리지오","리쥬란"]'::jsonb, 'RF+부스터 컴바인'),
('슈쥬베', '["슈링크","쥬베룩"]'::jsonb, 'HIFU+부스터'),
('울포', '["울쎄라","포텐자"]'::jsonb, 'HIFU+MRF')
ON CONFLICT (compound_name) DO NOTHING;

-- TORR RF scoring_criteria를 v3.1 영업 각도 구조로 UPDATE
UPDATE products SET scoring_criteria = '{
  "sales_angles": [
    {
      "id": "mens_target",
      "name": "A. 남성 타겟/뷰티 입문",
      "weight": 30,
      "keywords": ["남성 피부관리","맨즈 안티에이징","남성 리프팅","제모","옴므","포맨","남성 전용"],
      "pitch": "남성 환자는 통증에 민감해 이탈이 빠릅니다. 토르 리프팅은 무마취 시술로 남성 고객 락인율을 극대화합니다."
    },
    {
      "id": "bridge_care",
      "name": "B. 고가시술 브릿지 관리",
      "weight": 30,
      "keywords": ["써마지","아이써마지","울쎄라","실리프팅","민트실","안면거상"],
      "pitch": "고가 시술(써마지/울쎄라) 간 공백기를 소모품 0원인 토르 리프팅으로 채워 환자 이탈을 방지합니다."
    },
    {
      "id": "post_op_care",
      "name": "C. 수술 후 사후관리",
      "weight": 20,
      "keywords": ["안면거상","지방흡입","이물질 제거","붓기 관리","사후관리","거상술"],
      "pitch": "수술 후 요철/붓기에 다림질 효과를 발휘하여 프리미엄 사후관리 프로그램을 구성할 수 있습니다."
    },
    {
      "id": "painless_focus",
      "name": "D. 통증 최소화 중심",
      "weight": 20,
      "keywords": ["수면마취 없는","무통증 리프팅","직장인 점심시간","무마취","무통","논다운타임"],
      "pitch": "마취 없이 즉시 시술 가능. 직장인 점심시간 시술로 회전율을 높일 수 있습니다."
    },
    {
      "id": "combo_body",
      "name": "E. 복합시술/바디",
      "weight": 10,
      "keywords": ["슈링크","HIFU","눈가 주름","셀룰라이트","바디 타이트닝","이중턱"],
      "pitch": "기존 HIFU/바디 장비와 컴바인하여 탄력 보강 원스톱 솔루션을 제공합니다."
    }
  ],
  "combo_suggestions": [
    {"has_equipment": "써마지", "torr_role": "브릿지 유지 관리", "pitch": "고가 시술 간 공백기를 소모품 0원으로 채우세요"},
    {"has_equipment": "울쎄라", "torr_role": "브릿지 유지 관리", "pitch": "울쎄라 후 관리 시술로 환자 락인"},
    {"has_equipment": "안면거상", "torr_role": "수술 후 사후관리", "pitch": "다림질 효과로 요철을 펴주고 붓기를 빠르게"},
    {"has_equipment": "슈링크", "torr_role": "컴바인 탄력 보강", "pitch": "지방 감소 후 탄력을 채우는 원스톱 솔루션"},
    {"has_equipment": "실리프팅", "torr_role": "유지관리 보조", "pitch": "실 시술 후 자연스러운 탄력 유지를 위한 RF 보강"}
  ],
  "max_pitch_points": 2,
  "exclude_if": ["has_torr_rf"]
}'::jsonb
WHERE code = 'torr-rf';
