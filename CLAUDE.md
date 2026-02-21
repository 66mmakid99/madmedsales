# CLAUDE.md

> 이 파일은 AI 코딩 어시스턴트(Claude Code, Cursor 등)가 이 프로젝트를 이해하고 올바르게 작업하기 위한 지침입니다.

## 프로젝트 정체성

MADMEDSALES는 의료기기 제조유통사를 위한 **멀티 제품 자동화 영업 플랫폼**입니다.
병원 공개 정보를 AI로 심층 분석하여, 등록된 제품별로 매칭 스코어를 산출하고, 맞춤 이메일 시퀀스를 자동 실행합니다.

**특정 제품 하나를 파는 시스템이 아닙니다.**
같은 병원이 제품 A에는 S등급, 제품 B에는 C등급일 수 있습니다.
첫 고객사는 BRITZMEDI이지만, 구조적으로 어떤 의료기기든 등록하여 영업할 수 있습니다.

3개의 앱(web, admin, engine)이 하나의 Supabase를 공유하는 모노레포 구조입니다.

## 반드시 읽어야 할 문서

**작업 시작 전에 반드시 현재 Phase의 개발 명세서를 먼저 읽으세요.**

```
docs/00-INDEX.md          ← 전체 구조 + 읽는 순서
docs/01-SETUP.md          ← DB 스키마 전체 (항상 참조)
docs/02-DATA-COLLECTION.md
docs/03-SCORING.md
docs/04-EMAIL.md
docs/05-RESPONSE.md
docs/06-DEMO-CRM.md
docs/07-PAYMENT.md
```

DB 테이블 구조가 필요하면 **항상 `docs/01-SETUP.md`** 를 참조하세요. 임의로 테이블을 만들지 마세요.

## 핵심 데이터 모델 (꼭 이해해야 할 것)

```
products (제품 마스터)
  └── 각 제품에 scoring_criteria, email_guide가 정의됨

hospitals (병원 마스터)
  ├── hospital_equipments (보유 장비)
  ├── hospital_treatments (시술 메뉴)
  └── hospital_profiles (1단계: 제품 무관 프로파일)

product_match_scores (2단계: 제품 × 병원 매칭)
  └── 1 hospital × 1 product = 1 score

leads (영업 대상 = 병원 × 제품)
  └── 1 hospital × 1 product = 1 lead
  └── 같은 병원이 여러 제품의 리드일 수 있음
```

**이 구조를 절대 깨뜨리지 마세요.** 리드, 이메일, 데모 등 모든 영업 활동에는 반드시 `product_id`가 포함됩니다.

## 기술 스택 (절대 변경 금지)

| 영역 | 확정 기술 | 절대 쓰지 말 것 |
|------|----------|----------------|
| 공개 웹 | Astro 5 + React 19 + Tailwind 4 | Next.js, Nuxt, SvelteKit |
| 관리자 | React 19 + Vite 7 + Tailwind 4 | Create React App, Webpack |
| 상태관리 | Zustand | Redux, MobX, Jotai |
| API 서버 | Hono + TypeScript | Express, Fastify, Nest.js |
| 런타임 | Cloudflare Workers | Node.js 서버, Vercel, AWS Lambda |
| DB | Supabase (PostgreSQL) | Firebase, MongoDB, PlanetScale |
| AI | Claude API + Gemini Flash | OpenAI GPT, LangChain |
| 이메일 | Resend | SendGrid, Mailgun, AWS SES |
| 스타일 | Tailwind 4 | styled-components, CSS Modules, Emotion |

## 코딩 규칙

### TypeScript

- **strict mode 필수** (`"strict": true`)
- `any` 타입 사용 금지. 타입을 모르겠으면 `unknown`을 쓰고 타입 가드를 작성
- 모든 함수에 명시적 리턴 타입 지정
- `packages/shared/src/types/`에 공유 타입 정의. 앱별로 중복 정의 금지
- enum 대신 `as const` + `type` 패턴 사용

```typescript
// ✅ Good
export const LEAD_STAGES = ['new', 'contacted', 'responded', 'demo_scheduled', 'demo_done', 'proposal', 'negotiation', 'closed_won', 'closed_lost', 'nurturing'] as const;
export type LeadStage = typeof LEAD_STAGES[number];

// ✅ Good - 제품 카테고리
export const PRODUCT_CATEGORIES = ['equipment', 'consumable', 'service'] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

// ❌ Bad
enum LeadStage { NEW = 'new', CONTACTED = 'contacted' }
```

### 네이밍

- **파일명**: kebab-case (`email-generator.ts`, `lead-detail.tsx`)
- **컴포넌트**: PascalCase (`LeadDetail.tsx`, `EmailPreview.tsx`)
- **함수/변수**: camelCase (`calculateScore`, `leadData`)
- **상수**: UPPER_SNAKE_CASE (`MAX_DAILY_EMAILS`, `DEFAULT_WEIGHTS`)
- **DB 컬럼**: snake_case (`created_at`, `hospital_id`) — Supabase/PostgreSQL 컨벤션
- **API 경로**: kebab-case (`/api/email-events`, `/api/scoring-results`)
- **타입/인터페이스**: PascalCase, `I` prefix 금지 (`Hospital`, `Lead`, `ScoringResult`)

### 파일 구조 규칙

- 한 파일에 300줄 넘기지 말 것. 넘으면 분리
- 컴포넌트는 기능 단위 폴더에 배치 (`components/leads/`, `components/emails/`)
- 서비스 로직은 `services/` 폴더에. 라우트 핸들러에 비즈니스 로직 직접 쓰지 말 것
- 유틸 함수는 `utils/` 또는 `lib/`에. 컴포넌트 안에 헬퍼 함수 인라인 금지

### React 컴포넌트

- **함수형 컴포넌트만** 사용 (클래스 컴포넌트 금지)
- 상태: 로컬은 `useState`, 글로벌은 Zustand store
- 데이터 페칭: 커스텀 훅 (`hooks/useLeads.ts`, `hooks/useHospitals.ts`)
- Supabase 클라이언트는 `lib/supabase.ts`에서 가져올 것
- `useEffect` 최소화. 가능하면 이벤트 핸들러에서 처리

### Hono API (engine)

```typescript
// ✅ 라우트 파일 구조
// routes/leads.ts
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { getLeads, getLeadById } from '../services/leadService';

const app = new Hono();

app.use('*', authMiddleware);

app.get('/', async (c) => {
  const result = await getLeads(c.env, c.req.query());
  return c.json(result);
});

export default app;

// ✅ 서비스 파일에 비즈니스 로직
// services/leadService.ts
export async function getLeads(env: Bindings, filters: LeadFilters): Promise<Lead[]> {
  // 로직 여기에
}
```

### Supabase 쿼리

- `supabase-js` 클라이언트 사용 (직접 SQL 금지, 마이그레이션 제외)
- `.select()` 시 필요한 컬럼만 명시 (`*` 남발 금지)
- 에러 핸들링 필수: `const { data, error } = await supabase.from(...)`
- RLS(Row Level Security) 적용된 테이블은 anon key로, 관리 작업은 service role key로

### AI API 호출

- 모든 프롬프트는 `services/ai/prompts/` 폴더에 별도 파일로 관리
- 프롬프트에 `version` 주석 필수 (`// v1.0 - 2026-02-20`)
- AI 응답은 반드시 try-catch + JSON 파싱 에러 핸들링
- **제품 정보를 프롬프트에 동적 주입** (하드코딩 절대 금지)
- 모델 선택: S등급 고가장비 → Sonnet, 나머지 → Haiku
- 웹페이지 분석 → Gemini Flash

```typescript
// ✅ AI 호출 패턴 (제품 정보 동적 주입)
const prompt = buildEmailPrompt({
  product: await getProduct(lead.product_id),  // 제품 정보 동적 로드
  hospital: await getHospital(lead.hospital_id),
  matchScore: await getMatchScore(lead.match_score_id),
  step: sequenceStep,
});

try {
  const model = selectModel(product, lead.grade);
  const response = await anthropic.messages.create({
    model,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(text);
} catch (error) {
  console.error('AI API error:', error);
}
```

## 에러 핸들링

```typescript
// ✅ API 에러 응답 형식
return c.json({
  success: false,
  error: {
    code: 'LEAD_NOT_FOUND',
    message: '해당 리드를 찾을 수 없습니다.',
  }
}, 404);

// ✅ 성공 응답 형식
return c.json({
  success: true,
  data: result,
});
```

## 빌드 & 테스트

- 코드 작성 후 반드시 빌드 확인 (`npm run build`)
- 새 기능 추가 시 해당 API의 기본 테스트 작성
- DB 스키마 변경 시 반드시 마이그레이션 파일 생성 (`supabase/migrations/`)
- 환경변수 추가 시 `.env.example`도 업데이트

## 하지 말 것 (금지 사항)

1. **DB 테이블을 임의로 만들지 마세요.** `docs/01-SETUP.md`에 정의된 스키마만 사용.
2. **기술 스택을 바꾸지 마세요.** 위 표의 "절대 쓰지 말 것"에 해당하는 라이브러리 도입 금지.
3. **한 파일에 모든 것을 넣지 마세요.** 라우트/서비스/타입/유틸 분리.
4. **추측하지 마세요.** 잘 모르는 API나 라이브러리는 실제로 확인한 것만 사용.
5. **안 되는 건 안 된다고 말해주세요.** 동작하지 않는 코드를 동작하는 것처럼 설명하지 말 것.
6. **커밋 전에 빌드 테스트를 건너뛰지 마세요.**
7. **console.log를 프로덕션 코드에 남기지 마세요.**
8. **제품 정보를 하드코딩하지 마세요.** 항상 products 테이블에서 동적으로 로드.
9. **리드/이메일/데모에 product_id를 빠뜨리지 마세요.** 모든 영업 활동은 제품 단위.

## 커밋 메시지

```
feat(engine): 제품별 매칭 스코어 API 구현
fix(admin): 제품 필터 리드 목록 오류 수정
chore(scripts): 심평원 크롤러 에러 핸들링 추가
docs: Phase 2 개발 명세 업데이트
```

형식: `type(scope): 설명` (한국어 OK)
type: feat, fix, chore, docs, refactor, style, test

## 환경변수 참조

```
# Engine (apps/engine/.dev.vars)
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY
RESEND_API_KEY, RESEND_WEBHOOK_SECRET
KAKAO_API_KEY, KAKAO_SENDER_KEY
ADMIN_URL, WEB_URL

# Admin (apps/admin/.env)
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL

# Web (apps/web/.env)
PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_API_URL

# Scripts (scripts/.env)
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
DATA_GO_KR_API_KEY, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
GOOGLE_AI_API_KEY, KAKAO_REST_API_KEY
```

## 도움이 필요할 때

- DB 구조 → `docs/01-SETUP.md`
- 특정 기능 스펙 → 해당 Phase의 `docs/0X-*.md`
- 비즈니스 맥락 → `README.md`
- 기존 유사 코드 → MADMEDCHECK 프로젝트 패턴 참고 (Hono+TS+D1 → Hono+TS+Supabase로 전환)
