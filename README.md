# MADMEDSALES

> BRITZMEDI TORR RF 의료기기 AI 자동화 온라인 영업 시스템

한국 피부과/성형외과 병원에 TORR RF(고주파 리프팅 장비)를 AI가 자동으로 영업하는 B2B SaaS 시스템입니다.

## 시스템 개요

병원 데이터 수집 → AI 스코어링(5대 축) → 등급별 맞춤 이메일 → 반응 추적 → 자동 팔로업 → 카카오톡 전환 → 데모 → 계약

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
| AI | Claude API (이메일/스코어링) + Gemini Flash (웹분석) |
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

### 설치

```bash
git clone https://github.com/66mmakid99/madmedsales.git
cd madmedsales
npm install
```

### 환경변수

```bash
# 각 앱의 .env 파일 생성 (아래 예시 참고)
cp apps/engine/.dev.vars.example apps/engine/.dev.vars
cp apps/admin/.env.example apps/admin/.env
cp apps/web/.env.example apps/web/.env
cp scripts/.env.example scripts/.env
```

### 실행

```bash
# 전체 동시 실행
npm run dev

# 개별 실행
npm run dev:web      # http://localhost:4321
npm run dev:admin    # http://localhost:5174
npm run dev:engine   # http://localhost:8787
```

### DB 마이그레이션

```bash
cd supabase
supabase db push
```

### 크롤러 실행

```bash
cd scripts
npm run crawl:hira      # 심평원 데이터 수집
npm run crawl:naver     # 네이버 플레이스 수집
npm run crawl:web       # 병원 웹사이트 크롤링
npm run upload          # DB 업로드
npm run pipeline        # 전체 파이프라인 (위 순서대로 실행)
```

## 배포

```bash
npm run deploy:web      # Cloudflare Pages → www.madmedsales.com
npm run deploy:admin    # Cloudflare Pages → admin.madmedsales.com
npm run deploy:engine   # Cloudflare Workers → api.madmedsales.com
```

## 개발 문서

`docs/` 폴더에 Phase별 개발 명세서가 있습니다. **순서대로 읽으며 개발하세요.**

| 파일 | 내용 | 기간 |
|------|------|------|
| `docs/00-INDEX.md` | 전체 가이드, 읽는 순서 | - |
| `docs/01-SETUP.md` | 프로젝트 셋업, DB 스키마 전체 | Week 1~2 |
| `docs/02-DATA-COLLECTION.md` | 병원 데이터 수집 | Week 3~4 |
| `docs/03-SCORING.md` | 5대 축 스코어링 엔진 | Week 5~6 |
| `docs/04-EMAIL.md` | AI 이메일 생성/발송/추적 | Week 7~8 |
| `docs/05-RESPONSE.md` | 반응 분석 + 팔로업 + 카카오톡 | Week 9~10 |
| `docs/06-DEMO-CRM.md` | 데모 + CRM + 런칭 | Week 11~12 |
| `docs/07-PAYMENT.md` | 온라인 결제 (추후) | 추후 |

## 비즈니스 컨텍스트

- **회사**: BRITZMEDI (대표: 이신재)
- **제품**: TORR RF (고주파 피부 리프팅/타이트닝 장비)
- **가격**: 2,500~2,800만원
- **타깃**: 한국 피부과/성형외과 의원 (수도권 우선)
- **영업 방식**: AI가 수집→분석→접촉→팔로업 전 과정 자동화
- **수수료**: 판매수수료 5~8M 중 MADMEDSALES:영업팀 = 50:50 (조정 가능)
