# Phase 1: 병원 데이터 수집 (Week 3~4)

## 이 Phase의 목표

수도권 피부과/성형외과 병원 2,000건 이상의 데이터를 수집하고, 장비/시술 정보까지 보강하여 DB에 적재.

## 선행 조건

- Phase 0 완료 (DB 테이블 생성, Supabase 연동)
- 심평원 공공데이터 API 키 발급 완료
- Gemini Flash API 키 준비

## 완료 체크리스트

- [ ] 심평원 데이터 수집 스크립트 (피부과/성형외과 전국)
- [ ] 네이버 플레이스 크롤러 (시술 메뉴, 리뷰 수 등)
- [ ] 병원 웹사이트 크롤러 + Gemini 분석 (장비/시술 추출)
- [ ] 데이터 DB 업로드 파이프라인
- [ ] 수도권 1차 데이터 수집 실행 (2,000건+)
- [ ] 데이터 품질 점수 계산 로직

---

## 1. 수집 데이터 소스

| 소스 | 수집 항목 | 방식 |
|------|----------|------|
| 심평원 API | 병원명, 주소, 전화, 진료과목, 개원일, 의사 수 | 공공 API |
| 네이버 플레이스 | 시술 메뉴, 가격, 리뷰 수, 운영시간, 사진 | 크롤링 |
| 병원 홈페이지 | 보유 장비, 시술 상세, 원장 이력 | 크롤링 + Gemini |
| 카카오 지도 | 위도/경도 좌표 | API |

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
├── utils/
│   ├── supabase.ts             # Supabase 클라이언트
│   ├── delay.ts                # 크롤링 간격 유틸
│   └── logger.ts               # 로깅
├── data/                       # 수집 중간 데이터 (JSON)
│   ├── hira-raw/
│   ├── naver-raw/
│   └── web-raw/
├── package.json
└── tsconfig.json
```

### scripts/package.json

```json
{
  "name": "@madmedsales/scripts",
  "private": true,
  "scripts": {
    "crawl:hira": "ts-node crawler/crawl-hira.ts",
    "crawl:naver": "ts-node crawler/crawl-naver.ts",
    "crawl:web": "ts-node crawler/crawl-hospital-web.ts",
    "analyze:web": "ts-node analysis/analyze-web.ts",
    "upload": "ts-node upload/upload-to-db.ts",
    "geocode": "ts-node crawler/geocode.ts",
    "pipeline": "npm run crawl:hira && npm run geocode && npm run crawl:naver && npm run upload"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "cheerio": "^1.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "ts-node": "^10.9.0",
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0"
  }
}
```

---

## 3. 심평원 데이터 수집

### API 정보

```
공공데이터포털: https://www.data.go.kr
API: 건강보험심사평가원_의료기관 기본정보 조회
엔드포인트: http://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList

파라미터:
- sidoCd: 시도 코드
- sgguCd: 시군구 코드  
- emdongNm: 읍면동
- yadmNm: 요양기관명
- clCd: 종별코드 (01=상급종합, 11=종합, 21=병원, 31=의원)
- dgsbjtCd: 진료과목코드 (14=피부과, 09=성형외과)
```

### crawl-hira.ts 핵심 로직

```typescript
/**
 * 수집 대상:
 * - 진료과목: 피부과(14), 성형외과(09)
 * - 종별: 의원(31), 병원(21)
 * - 지역: 전국 (1차 수도권 우선)
 * 
 * 수집 항목:
 * - yadmNm: 병원명
 * - addr: 주소
 * - telno: 전화번호
 * - estbDd: 개설일자
 * - drTotCnt: 의사 총수
 * - cmdcResdntCnt: 전문의 수
 * - clCdNm: 종별명
 * - dgsbjtCdNm: 진료과목
 * - ykiho: 요양기관번호 (고유키)
 */

// 수도권 시도 코드
const PRIORITY_REGIONS = [
  { code: '110000', name: '서울' },
  { code: '410000', name: '경기' },
  { code: '280000', name: '인천' },
];

// 전국 나머지 (2차 수집)
const OTHER_REGIONS = [
  { code: '260000', name: '부산' },
  { code: '270000', name: '대구' },
  // ... 나머지
];

// 수집 → data/hira-raw/{region}.json으로 저장
// 크롤링 간격: 요청당 500ms (API 부하 방지)
```

### 결과 데이터 형태

```json
{
  "ykiho": "JDQ4MTg4MSM1MSMkMSMkMCMkOTkkMzIxIzExIyQxIyQzIyQ0OSQyNjEjNjEjJDEjJDEjJDkx",
  "yadmNm": "강남피부과의원",
  "clCdNm": "의원",
  "dgsbjtCdNm": "피부과",
  "addr": "서울특별시 강남구 테헤란로 123",
  "telno": "02-1234-5678",
  "estbDd": "20150301",
  "drTotCnt": 2,
  "cmdcResdntCnt": 1
}
```

---

## 4. 네이버 플레이스 크롤링

### 수집 전략

```
1. 병원명 + 주소로 네이버 플레이스 검색
2. 매칭된 플레이스 페이지에서 추가 정보 수집
3. 매칭 실패 시 skip (수동 보완 가능)

수집 항목:
- 시술 메뉴 + 가격 (네이버 예약 메뉴)
- 리뷰 수 (인기도 지표)
- 영업시간
- 네이버 플레이스 URL

주의:
- 네이버 크롤링은 속도 제한 필수 (요청당 2~3초)
- User-Agent 설정
- 대량 크롤링 시 IP 차단 가능 → 소량씩 나눠서 실행
```

### crawl-naver.ts 핵심 로직

```typescript
/**
 * 1. 네이버 검색 API로 플레이스 ID 획득
 *    GET https://openapi.naver.com/v1/search/local.json?query={병원명+지역}
 * 
 * 2. 플레이스 상세 페이지 크롤링 (Cheerio)
 *    https://m.place.naver.com/hospital/{placeId}/home
 * 
 * 3. 시술 메뉴 페이지
 *    https://m.place.naver.com/hospital/{placeId}/price
 * 
 * 결과 → data/naver-raw/{hospital_id}.json
 */

interface NaverPlaceData {
  placeId: string;
  naverUrl: string;
  reviewCount: number;
  treatments: {
    name: string;
    category: string;
    priceMin: number;
    priceMax: number;
  }[];
  operatingHours: string;
}
```

---

## 5. 병원 웹사이트 크롤링 + AI 분석

### 수집 전략

```
1. hospitals.website에서 홈페이지 URL 확보 (심평원 or 네이버에서)
2. 홈페이지 HTML 수집 (주요 페이지: 메인, 시술소개, 장비소개, 의료진)
3. Gemini Flash로 구조화 분석
4. 결과 → hospital_equipments, hospital_treatments에 저장
```

### analyze-web.ts 핵심 로직

```typescript
/**
 * Gemini Flash API 호출
 * 
 * 입력: 병원 홈페이지 HTML (텍스트 추출본)
 * 출력: 구조화된 장비/시술 데이터
 */

const ANALYSIS_PROMPT = `
당신은 한국 미용 의료 시장 전문가입니다.
이 병원 홈페이지 내용을 분석하여 다음 정보를 추출하세요.

[추출할 정보]
1. 보유 장비 목록
   - equipment_name: 장비명 (예: 울쎄라, 써마지, 인모드, 피코레이저)
   - equipment_brand: 브랜드/제조사
   - equipment_category: rf | laser | ultrasound | ipl | other
   - equipment_model: 모델명 (알 수 있는 경우)
   - estimated_year: 추정 도입년도 (알 수 있는 경우)

2. 시술 메뉴
   - treatment_name: 시술명
   - treatment_category: lifting | tightening | toning | filler | botox | laser_toning | scar | acne | whitening | other
   - price_min: 최소 가격 (원, 알 수 있는 경우)
   - price_max: 최대 가격 (원, 알 수 있는 경우)
   - is_promoted: 메인에 노출되거나 강조된 시술인지 (true/false)

3. 병원 특성
   - main_focus: 주력 분야 (예: "리프팅 전문", "여드름/흉터", "종합 피부")
   - target_audience: 주요 타깃 환자층 추정

[규칙]
- 확실하지 않은 정보는 null로 표시
- 장비명은 한국에서 통용되는 이름 사용
- JSON 형식으로만 응답 (설명 텍스트 없이)

[홈페이지 내용]
{html_text}
`;

// 응답 형태
interface WebAnalysisResult {
  equipments: {
    equipment_name: string;
    equipment_brand: string | null;
    equipment_category: string;
    equipment_model: string | null;
    estimated_year: number | null;
  }[];
  treatments: {
    treatment_name: string;
    treatment_category: string;
    price_min: number | null;
    price_max: number | null;
    is_promoted: boolean;
  }[];
  hospital_profile: {
    main_focus: string;
    target_audience: string;
  };
}
```

---

## 6. 주소 → 좌표 변환 (지오코딩)

```typescript
/**
 * 카카오 지도 API 사용
 * GET https://dapi.kakao.com/v2/local/search/address.json?query={address}
 * 
 * Headers: Authorization: KakaoAK {REST_API_KEY}
 * 
 * 결과: latitude, longitude → hospitals 테이블 업데이트
 * 
 * 제한: 일 30만 콜 (무료)
 * 크롤링 간격: 요청당 100ms
 */
```

---

## 7. DB 업로드 파이프라인

### upload-to-db.ts

```typescript
/**
 * 수집 데이터를 Supabase에 적재하는 파이프라인
 * 
 * 실행 순서:
 * 1. data/hira-raw/ → hospitals 테이블 (기본 정보)
 * 2. geocode 결과 → hospitals.latitude, longitude 업데이트
 * 3. data/naver-raw/ → hospital_treatments 테이블
 * 4. data/web-raw/ → hospital_equipments, hospital_treatments 테이블
 * 5. 데이터 품질 점수 계산 → hospitals.data_quality_score 업데이트
 * 
 * 중복 처리:
 * - business_number 기준 UPSERT
 * - 네이버/웹 데이터는 hospital_id로 연결
 * 
 * 에러 처리:
 * - 실패 건은 data/errors.json에 기록
 * - 재실행 시 이미 적재된 건은 skip
 */
```

### 데이터 품질 점수 (data_quality_score)

```typescript
/**
 * 0~100점. 각 항목 보유 시 가점:
 * 
 * 기본 정보 (필수):
 * - 병원명: +10
 * - 주소: +10
 * - 전화번호: +5
 * - 이메일: +15 (콜드메일 발송 가능 여부)
 * 
 * 장비/시술:
 * - 보유 장비 1개 이상: +15
 * - 시술 메뉴 1개 이상: +10
 * - 시술 가격 정보: +5
 * 
 * 위치:
 * - 좌표 (위도/경도): +10
 * 
 * 부가:
 * - 원장명: +5
 * - 개원일: +5
 * - 웹사이트: +5
 * - 네이버 플레이스: +5
 * 
 * 합계: 100점 만점
 * 
 * 50점 미만: 스코어링 제외 (데이터 부족)
 * 50~69점: 스코어링 가능 (일부 축 추정)
 * 70점 이상: 스코어링 신뢰도 높음
 */
```

---

## 8. 이메일 주소 수집 전략

> 가장 중요: 이메일이 없으면 콜드메일을 보낼 수 없음

```
수집 우선순위:
1. 병원 홈페이지 "문의" 또는 "연락처" 페이지에서 이메일 추출
2. 네이버 플레이스 정보에서 이메일 확인
3. 도메인 기반 추정: 웹사이트가 xxx.com이면 info@xxx.com, contact@xxx.com 등 시도
4. 수동 보완: 이메일 없는 고등급 병원은 직접 조사

수집 시 주의:
- 개인 이메일 (gmail, naver 등)은 스팸 위험 높음 → 가급적 병원 도메인 이메일 우선
- info@, contact@, admin@ 등 일반 주소 활용
- 수집 불가 병원은 is_target = false 처리 또는 별도 관리
```

---

## 9. 실행 계획

### Week 3: 수집 스크립트 개발 + 1차 수집

```
Day 1-2: 심평원 크롤러 + 지오코딩
Day 3-4: 네이버 플레이스 크롤러
Day 5: DB 업로드 파이프라인
→ 1차 수집: 서울 피부과/성형외과 (~1,500건)
```

### Week 4: 웹 분석 + 보강 + 경기/인천 확대

```
Day 1-2: 병원 웹사이트 크롤러 + Gemini 분석
Day 3: 데이터 품질 점수 + 보완
Day 4-5: 경기/인천 수집 + 전체 파이프라인 검증
→ 목표: 2,000건+ 적재, 이메일 보유율 50%+
```

---

## 10. Engine API 추가 (이 Phase)

### routes/hospitals.ts

```typescript
/**
 * 병원 관련 API (admin 대시보드에서 사용)
 * 
 * GET    /api/hospitals          - 병원 목록 (필터, 페이지네이션)
 * GET    /api/hospitals/:id      - 병원 상세 (장비, 시술 포함)
 * PUT    /api/hospitals/:id      - 병원 정보 수정
 * GET    /api/hospitals/stats    - 통계 (지역별, 과목별 수)
 * POST   /api/hospitals/search   - 검색
 * 
 * 필터:
 * - sido, sigungu (지역)
 * - department (진료과목)
 * - status (active/closed)
 * - data_quality_score (최소점수)
 * - has_email (이메일 보유 여부)
 * - has_equipment (장비 정보 보유 여부)
 */
```

---

## 이 Phase 완료 후 상태

- `hospitals` 테이블: 2,000건+ (수도권)
- `hospital_equipments`: 장비 정보 보유 병원 500건+
- `hospital_treatments`: 시술 메뉴 보유 병원 800건+
- 이메일 보유율: 50%+ (최소 1,000건)
- `/api/hospitals` API 작동
- MADMEDCHECK 크롤링 파이프라인 패턴 재활용 확인
- → 다음: `03-SCORING.md`
