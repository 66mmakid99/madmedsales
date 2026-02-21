# Phase 1: 병원 데이터 수집 + 제품 등록 (Week 3~4)

## 이 Phase의 목표

수도권 피부과/성형외과 병원 2,000건+ 데이터를 수집하고, 제품 관리 시스템을 구축하여 "어떤 병원에 어떤 제품이 맞는지" 분석할 수 있는 기반 데이터 완성.

## 선행 조건

- Phase 0 완료 (DB 테이블 생성, Supabase 연동, 초기 제품 시딩)
- 심평원 공공데이터 API 키 발급 완료
- Gemini Flash API 키 준비

## 완료 체크리스트

- [ ] 심평원 데이터 수집 스크립트 (피부과/성형외과 전국)
- [ ] 네이버 플레이스 크롤러 (시술 메뉴, 리뷰 수 등)
- [ ] 병원 웹사이트 크롤러 + Gemini 분석 (장비/시술 추출)
- [ ] 데이터 DB 업로드 파이프라인
- [ ] 수도권 1차 데이터 수집 실행 (2,000건+)
- [ ] 데이터 품질 점수 계산 로직
- [ ] 제품 관리 API (CRUD)
- [ ] admin에서 제품 등록/수정 화면

---

## 1. 수집 데이터 소스 (제품과 무관한 병원 기본 데이터)

| 소스 | 수집 항목 | 방식 |
|------|----------|------|
| 심평원 API | 병원명, 주소, 전화, 진료과목, 개원일, 의사 수 | 공공 API |
| 네이버 플레이스 | 시술 메뉴, 가격, 리뷰 수, 운영시간 | 크롤링 |
| 병원 홈페이지 | 보유 장비, 시술 상세, 원장 이력 | 크롤링 + Gemini |
| 카카오 지도 | 위도/경도 좌표 | API |

> 중요: 이 단계에서 수집하는 데이터는 **제품과 무관한 병원 자체의 객관적 정보**입니다.
> "이 병원에 TORR RF가 맞는가?"는 Phase 2 스코어링에서 판단합니다.

---

## 2. 프로젝트 구조 (scripts/)

```
scripts/
├── crawler/
│   ├── crawl-hira.ts           # 심평원 데이터 수집
│   ├── crawl-naver.ts          # 네이버 플레이스 수집
│   ├── crawl-hospital-web.ts   # 병원 홈페이지 크롤링
│   └── geocode.ts              # 주소 → 좌표 변환
├── analysis/
│   └── analyze-web.ts          # Gemini로 장비/시술 추출
├── upload/
│   └── upload-to-db.ts         # 수집 데이터 → Supabase 업로드
├── seed/
│   └── seed-products.ts        # 제품 추가 등록 스크립트
├── utils/
│   ├── supabase.ts
│   ├── delay.ts
│   └── logger.ts
├── data/                       # 수집 중간 데이터 (JSON)
├── package.json
└── tsconfig.json
```

---

## 3. 심평원 데이터 수집

### API 정보

```
엔드포인트: http://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList

파라미터:
- sidoCd: 시도 코드
- sgguCd: 시군구 코드  
- clCd: 종별코드 (21=병원, 31=의원)
- dgsbjtCd: 진료과목코드 (14=피부과, 09=성형외과)
```

### crawl-hira.ts 핵심 로직

```typescript
/**
 * 수집 대상: 피부과(14), 성형외과(09) / 의원(31), 병원(21)
 * 1차 수도권 → 2차 전국
 * 
 * 수집 항목: yadmNm, addr, telno, estbDd, drTotCnt, cmdcResdntCnt, clCdNm, dgsbjtCdNm, ykiho
 * 크롤링 간격: 요청당 500ms
 */

const PRIORITY_REGIONS = [
  { code: '110000', name: '서울' },
  { code: '410000', name: '경기' },
  { code: '280000', name: '인천' },
];
```

---

## 4. 네이버 플레이스 크롤링

```typescript
/**
 * 1. 네이버 검색 API로 플레이스 ID 획득
 * 2. 플레이스 상세 페이지 크롤링
 * 3. 시술 메뉴 + 가격 수집
 * 
 * 결과: placeId, naverUrl, reviewCount, treatments[], operatingHours
 * 속도 제한: 요청당 2~3초
 */
```

---

## 5. 병원 웹사이트 크롤링 + AI 분석

### Gemini 분석 프롬프트 (제품 무관 = 범용)

```typescript
const ANALYSIS_PROMPT = `
당신은 한국 미용 의료 시장 전문가입니다.
이 병원 홈페이지 내용을 분석하여 다음 정보를 추출하세요.

[추출할 정보]

1. 보유 장비 목록 (가능한 모두 추출)
   - equipment_name: 장비명 (한국에서 통용되는 이름)
   - equipment_brand: 브랜드/제조사
   - equipment_category: rf | laser | ultrasound | ipl | injection | body | skinbooster | other
   - equipment_model: 모델명 (알 수 있는 경우)
   - estimated_year: 추정 도입년도 (알 수 있는 경우)

2. 시술 메뉴 (가능한 모두 추출)
   - treatment_name: 시술명
   - treatment_category: lifting | tightening | toning | filler | botox | laser_toning | scar | acne | whitening | body | skinbooster | hairloss | other
   - price_min/price_max: 가격 (원, 알 수 있는 경우)
   - is_promoted: 메인에 노출/강조된 시술인지

3. 병원 특성 (종합 판단)
   - main_focus: 주력 분야 (예: "리프팅 전문", "여드름/흉터", "종합 피부")
   - target_audience: 주요 타깃 환자층 추정
   - investment_tendency: aggressive | moderate | conservative (장비 투자 성향)
   - online_quality: high | medium | low (웹사이트 품질/정보 공개 수준)

[중요 규칙]
- 확실하지 않은 정보는 null
- 한국에서 통용되는 장비명 사용 (예: Thermage → 써마지)
- 같은 장비가 시술명으로도 쓰이는 경우 (예: 울쎄라) → 장비와 시술 모두에 기록
- JSON 형식으로만 응답

[홈페이지 내용]
{html_text}
`;
```

> 이전 버전과의 차이: "TORR RF에 맞는가?"를 여기서 판단하지 않음.
> 장비/시술을 있는 그대로 최대한 많이 추출하는 것이 목표.

---

## 6. 데이터 품질 점수 (data_quality_score)

```typescript
/**
 * 0~100점. 스코어링 가능 여부를 판단하는 기준.
 * 
 * 기본 정보:
 * - 병원명: +10, 주소: +10, 전화번호: +5, 이메일: +15
 * 
 * 장비/시술:
 * - 보유 장비 1개+: +15, 시술 메뉴 1개+: +10, 시술 가격: +5
 * 
 * 위치: 좌표(위도/경도): +10
 * 
 * 부가: 원장명: +5, 개원일: +5, 웹사이트: +5, 네이버: +5
 * 
 * 50점 미만: 프로파일링 제외
 * 50~69점: 프로파일링 가능 (일부 추정)
 * 70점+: 신뢰도 높음
 */
```

---

## 7. 제품 관리 시스템

### 제품 관리 API

```typescript
/**
 * GET    /api/products           - 제품 목록 (필터: category, status, manufacturer)
 * GET    /api/products/:id       - 제품 상세
 * POST   /api/products           - 제품 등록 (admin)
 * PUT    /api/products/:id       - 제품 수정 (admin)
 * DELETE /api/products/:id       - 제품 비활성화 (admin)
 * 
 * 제품 등록 시 필수:
 * - name, code, manufacturer, category
 * - scoring_criteria (이 제품의 매칭 기준)
 * - email_guide (AI 이메일 생성 가이드)
 * - target_departments
 * 
 * 제품 등록 시 선택:
 * - requires_equipment_keywords (소모품: 어떤 장비 보유 병원이 타깃)
 * - competing_keywords (교체 대상 장비)
 * - synergy_keywords (시너지 장비)
 */
```

### admin 제품 관리 화면

```
제품 목록:
┌──────────┬──────────┬────────┬────────┬────────┐
│ 제품명    │ 제조사    │ 유형    │ 가격대  │ 상태   │
├──────────┼──────────┼────────┼────────┼────────┤
│ TORR RF  │ BRITZMEDI│ 장비    │ 25~28M │ active │
│ 2mm 니들  │ BRITZMEDI│ 소모품  │ -      │ active │
│ [+ 제품 추가]                                    │
└──────────┴──────────┴────────┴────────┴────────┘

제품 등록/수정 폼:
- 기본 정보 (이름, 코드, 제조사, 카테고리, 가격)
- 타깃 설정 (진료과목, 병원 유형)
- 스코어링 기준 (JSON 에디터 or 폼)
- 이메일 가이드 (AI가 참고할 정보)
- 관련 키워드 (경쟁, 시너지, 필수 장비)
```

---

## 8. 이메일 주소 수집 전략

```
수집 우선순위:
1. 병원 홈페이지 "문의/연락처" 페이지에서 이메일 추출
2. 네이버 플레이스 정보에서 이메일 확인
3. 도메인 기반 추정: 웹사이트가 xxx.com → info@xxx.com, contact@xxx.com
4. 수동 보완: 이메일 없는 고등급 병원은 직접 조사

주의:
- 병원 도메인 이메일 우선 (info@, contact@, admin@)
- 이메일 없는 병원은 is_target 유지, 프로파일링은 실행하되 리드 미생성
```

---

## 9. 병원 관리 API

```typescript
/**
 * GET    /api/hospitals          - 병원 목록 (필터, 페이지네이션)
 * GET    /api/hospitals/:id      - 병원 상세 (장비, 시술 포함)
 * PUT    /api/hospitals/:id      - 병원 정보 수정
 * GET    /api/hospitals/stats    - 통계 (지역별, 과목별 수)
 * POST   /api/hospitals/search   - 검색
 * 
 * 필터: sido, sigungu, department, status, data_quality_score, has_email, has_equipment
 */
```

---

## 10. 실행 계획

### Week 3: 수집 스크립트 개발 + 1차 수집

```
Day 1-2: 심평원 크롤러 + 지오코딩
Day 3-4: 네이버 플레이스 크롤러
Day 5: DB 업로드 파이프라인 + 제품 관리 API
→ 1차 수집: 서울 피부과/성형외과 (~1,500건)
```

### Week 4: 웹 분석 + 보강 + 경기/인천 확대

```
Day 1-2: 병원 웹사이트 크롤러 + Gemini 분석
Day 3: 데이터 품질 점수 + admin 제품 관리 화면
Day 4-5: 경기/인천 수집 + 전체 파이프라인 검증
→ 목표: 2,000건+ 적재, 이메일 보유율 50%+
```

---

## 이 Phase 완료 후 상태

- `hospitals` 테이블: 2,000건+ (수도권)
- `hospital_equipments`: 장비 정보 보유 병원 500건+
- `hospital_treatments`: 시술 메뉴 보유 병원 800건+
- `products`: BRITZMEDI 제품 등록 완료 (TORR RF + 소모품 + 추가분)
- 이메일 보유율: 50%+ (최소 1,000건)
- 제품 관리 API + admin 화면 작동
- → 다음: `03-SCORING.md`
