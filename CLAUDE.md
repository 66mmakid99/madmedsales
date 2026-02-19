# CLAUDE.md

> 이 파일은 AI 코딩 어시스턴트(Claude Code, Cursor 등)가 이 프로젝트를 이해하고 올바르게 작업하기 위한 지침입니다.

## 프로젝트 정체성

MADMEDSALES는 한국 피부과/성형외과 병원에 TORR RF 의료기기를 AI가 자동으로 영업하는 시스템입니다.
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
export const LEAD_STAGES = ['new', 'contacted', 'responded', 'demo_scheduled', 'closed_won', 'closed_lost', 'nurturing'] as const;
export type LeadStage = typeof LEAD_STAGES[number];

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
- S등급 이메일은 Claude Sonnet, 나머지는 Claude Haiku
- 웹페이지 분석은 Gemini Flash

```typescript
// ✅ AI 호출 패턴
try {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(text);
  // validate parsed...
} catch (error) {
  console.error('AI API error:', error);
  // fallback 로직 또는 에러 반환
}
```

## 에러 핸들링

- API: 모든 에러를 잡아서 구조화된 응답 반환
- 절대 에러를 삼키지(swallow) 말 것

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
7. **console.log를 프로덕션 코드에 남기지 마세요.** 디버깅 후 제거 또는 적절한 로거 사용.

## 커밋 메시지

```
feat(engine): 스코어링 API 구현
fix(admin): 리드 목록 필터 오류 수정
chore(scripts): 심평원 크롤러 에러 핸들링 추가
docs: Phase 2 개발 명세 업데이트
```

형식: `type(scope): 설명` (한국어 OK)
type: feat, fix, chore, docs, refactor, style, test

## 환경변수 참조

```
# Engine (apps/engine/.dev.vars)
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
- 비즈니스 맥락 → `README.md` 하단
- 기존 유사 코드 → MADMEDCHECK 프로젝트 패턴 참고 (Hono+TS+D1 → Hono+TS+Supabase로 전환)
