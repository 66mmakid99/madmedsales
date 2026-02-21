# MADMEDSALES

> 의료기기 제조유통사를 위한 AI 자동화 영업 플랫폼

## 한줄 요약

피부과/성형외과 병원의 공개 정보를 AI가 심층 분석하여, **등록된 제품별로 최적의 병원을 찾아내고 자동으로 영업**하는 B2B 플랫폼.

## 왜 이게 필요한가

의료기기 영업은 아직도 인맥 + 발품 + 감에 의존합니다.
- "이 병원에 RF가 필요한지" 알려면 직접 방문해야 합니다.
- 영업사원 1명이 커버할 수 있는 병원은 하루 3~5곳입니다.
- 같은 회사에서 여러 제품을 팔면서도 어떤 병원에 어떤 제품이 맞는지 체계적으로 관리하지 못합니다.

MADMEDSALES는 이 과정을 자동화합니다.

## 시스템 개요

```
[1] 병원 데이터 수집 (심평원 + 네이버 + 홈페이지 AI 분석)
     ↓
[2] 병원 프로파일 생성 (제품과 무관한 객관적 분석)
     ↓
[3] 제품별 매칭 스코어 산출 (같은 병원도 제품마다 점수가 다름)
     ↓
[4] 높은 매칭 → 리드 자동 생성 → 제품별 이메일 시퀀스
     ↓
[5] 반응 추적 → 관심도 자동 업데이트 → 팔로업 → 카카오톡 전환
     ↓
[6] 데모 → 평가 → 계약
```

## 멀티 제품이 핵심

이 시스템은 **특정 제품 하나를 파는 도구가 아닙니다.**

```
같은 "강남피부과"라도:
├── TORR RF (고가 장비): S등급 → 5단계 이메일 시퀀스 → 데모 → 계약
├── 2mm 바늘 (소모품): EXCLUDE (TORR RF 미보유 → 판매 후 자동 전환)
└── 관리장비 (제휴사): A등급 → 3단계 시퀀스 → 데모

모든 영업 활동(리드, 이메일, 데모)에 product_id가 있습니다.
```

## 첫 번째 고객사: BRITZMEDI

| 제품 | 유형 | 가격대 | 시점 |
|------|------|--------|------|
| TORR RF | 고가 장비 | 2,500~2,800만원 | 지금 |
| 2mm 니들 | 소모품 | 수만~수십만원 | 지금 |
| 유통 의료기기 | 장비 | 제품별 상이 | 수시 |
| 제휴사 관리장비 | 장비 | 제품별 상이 | 수시 |
| 신제품 | 장비 | TBD | 올해 말 |

- 대표: 이신재
- CMO: 이성호 (sh.lee@britzmedi.co.kr)

## 모노레포 구조

```
madmedsales/
├── apps/
│   ├── web/          # 고객용 공개 웹 (Astro 5 + React 19 + Tailwind 4)
│   ├── admin/        # 관리자 CRM 대시보드 (React 19 + Vite 7 + Tailwind 4)
│   └── engine/       # API 서버 + AI 엔진 (Hono + TypeScript on Cloudflare Workers)
├── packages/
│   └── shared/       # 공유 타입/상수/유틸
├── scripts/          # 크롤러, 시딩, 마이그레이션 스크립트 (Node.js)
├── supabase/         # DB 마이그레이션
└── docs/             # Phase별 개발 명세서 (00~07)
```

## 도메인

| 도메인 | 용도 | 앱 |
|--------|------|-----|
| www.madmedsales.com | 고객용 웹사이트 | apps/web |
| admin.madmedsales.com | 관리자 대시보드 | apps/admin |
| api.madmedsales.com | API 서버 | apps/engine |

## 기술 스택

| 영역 | 기술 |
|------|------|
| 공개 웹 | Astro 5 + React 19 + Tailwind 4 |
| 관리자 | React 19 + Vite 7 + Tailwind 4 + Zustand |
| API | Hono + TypeScript (Cloudflare Workers) |
| DB | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| AI | Claude API (이메일/스코어링/분석) + Gemini Flash (웹분석/OCR) |
| 이메일 | Resend (발송 + 추적) |
| 메시징 | 카카오 비즈메시지 (알림톡) |
| 인프라 | Cloudflare (Pages + Workers + KV + Queues) |
| 지도 | 카카오 지도 API |
| 크롤러 | Node.js + Axios + Cheerio (로컬 실행) |

## 로컬 개발

### 사전 준비

- Node.js 20+
- npm 10+
- Wrangler CLI (`npm i -g wrangler`)
- Supabase CLI (`npm i -g supabase`)

### 설치 + 실행

```bash
git clone https://github.com/66mmakid99/madmedsales.git
cd madmedsales
npm install

# 환경변수 설정
cp apps/engine/.dev.vars.example apps/engine/.dev.vars
cp apps/admin/.env.example apps/admin/.env
cp apps/web/.env.example apps/web/.env

# 전체 동시 실행
npm run dev

# 개별 실행
npm run dev:web      # http://localhost:4321
npm run dev:admin    # http://localhost:5174
npm run dev:engine   # http://localhost:8787
```

### DB + 크롤러

```bash
# DB 마이그레이션
cd supabase && supabase db push

# 크롤러 (scripts/)
npm run crawl:hira      # 심평원 데이터
npm run crawl:naver     # 네이버 플레이스
npm run crawl:web       # 병원 웹사이트 + AI 분석
npm run upload          # DB 업로드
npm run pipeline        # 전체 파이프라인
```

### 배포

```bash
npm run deploy:web      # Cloudflare Pages → www.madmedsales.com
npm run deploy:admin    # Cloudflare Pages → admin.madmedsales.com
npm run deploy:engine   # Cloudflare Workers → api.madmedsales.com
```

## 개발 문서

| 파일 | 내용 | 기간 |
|------|------|------|
| `docs/00-INDEX.md` | 전체 가이드, 읽는 순서 | - |
| `docs/01-SETUP.md` | 프로젝트 셋업, DB 전체 스키마 | Week 1~2 |
| `docs/02-DATA-COLLECTION.md` | 병원 데이터 수집 + 제품 등록 | Week 3~4 |
| `docs/03-SCORING.md` | 2단계 스코어링 (프로파일 + 매칭) | Week 5~6 |
| `docs/04-EMAIL.md` | 제품별 AI 이메일 자동화 | Week 7~8 |
| `docs/05-RESPONSE.md` | 반응 분석 + 팔로업 + 카카오톡 | Week 9~10 |
| `docs/06-DEMO-CRM.md` | 데모 + CRM + 런칭 | Week 11~12 |
| `docs/07-PAYMENT.md` | 온라인 결제 (추후) | 추후 |

## 비즈니스 모델

```
영업 자동화 플랫폼으로서의 가치:

[단기] BRITZMEDI 자체 영업 자동화
- TORR RF 판매 수수료: 500~800만원/건
  - 직접 계약: 100%
  - 영업팀 핸드오프: 50:50
- 소모품 반복 주문: 추가 수익

[중기] 멀티 제품 확장
- BRITZMEDI 신제품 출시 즉시 시퀀스 추가
- 유통/제휴 제품 → 같은 병원 데이터 재활용

[장기] SaaS 확장 가능성
- 다른 의료기기 제조유통사에게 플랫폼 제공
- 병원 데이터 + 분석 인프라 = 핵심 자산
```

## 월 운영 예산: 100만원

실 예상 비용: ~15만원 (Supabase Free + Cloudflare Free + AI API)
여유분: AI 품질 향상, 발송량 확대, 추가 API 비용
