# MADMEDSALES 개발 가이드

## 이 문서 모음의 사용법

이 폴더에는 MADMEDSALES 온라인 자동화 영업 시스템의 개발 문서가 Phase별로 나뉘어 있습니다.
**순서대로 하나씩 읽으며 개발하세요.** 각 문서는 해당 Phase에 필요한 모든 정보를 포함합니다.

## 프로젝트 한줄 요약

BRITZMEDI의 TORR RF 장비를 한국 피부과/성형외과 병원에 AI가 자동으로 영업하는 시스템.
병원 데이터 수집 → AI 스코어링 → 맞춤 이메일 → 반응 추적 → 카카오톡 전환 → 데모 → 계약.

## 읽는 순서

| 순서 | 파일 | 내용 | 개발 기간 |
|------|------|------|----------|
| 1 | `01-SETUP.md` | 프로젝트 셋업, 기술 스택, DB 전체 스키마 | Week 1~2 |
| 2 | `02-DATA-COLLECTION.md` | 병원 데이터 수집 (심평원, 크롤링, AI 분석) | Week 3~4 |
| 3 | `03-SCORING.md` | 5대 축 스코어링 엔진 + AI 분석 메모 | Week 5~6 |
| 4 | `04-EMAIL.md` | AI 이메일 생성 + 발송 + 추적 | Week 7~8 |
| 5 | `05-RESPONSE.md` | 반응 분석 + 자동 팔로업 + 카카오톡 | Week 9~10 |
| 6 | `06-DEMO-CRM.md` | 데모 시스템 + CRM 대시보드 + 런칭 | Week 11~12 |
| 7 | `07-PAYMENT.md` | 온라인 결제 (나중에 개발) | 추후 |

## 핵심 기술 스택 (전 Phase 공통)

- **프론트**: Astro 5 + React 19 + Tailwind 4 (web) / React 19 + Vite 7 + Tailwind 4 (admin)
- **백엔드**: Hono + TypeScript (Cloudflare Workers)
- **DB**: Supabase (PostgreSQL + Auth + Storage)
- **AI**: Claude API (이메일/스코어링) + Gemini Flash (웹페이지 분석)
- **인프라**: Cloudflare (Pages + Workers + KV + Queues)
- **이메일**: Resend
- **카카오**: 비즈메시지 API + 지도 API

## 도메인 구조

| 도메인 | 용도 | 앱 |
|--------|------|-----|
| www.madmedsales.com | 고객용 공개 웹사이트 | apps/web |
| admin.madmedsales.com | 관리자 대시보드 | apps/admin |
| api.madmedsales.com | API 서버 | apps/engine |

## 월 예산: 100만원

실제 예상 운영비는 월 ~15만원. 여유분은 AI 품질 향상, 발송량 확대에 활용.

## 기존 프로젝트 재활용

MADMEDCHECK에서 만든 크롤링 파이프라인, Hono+TypeScript 스택, React 대시보드 패턴을 그대로 활용합니다.
