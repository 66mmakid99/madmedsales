# 버그 수정: Failed to fetch + 새로고침 로그인 풀림

두 가지 버그를 순서대로 고쳐. 중간에 멈추지 마.

---

## Phase 0: 현재 상태 파악

```bash
# 1. 환경변수 확인
cat .env
cat .env.local 2>/dev/null
cat .env.production 2>/dev/null

# 2. API 호출하는 곳 찾기
grep -rn "fetch\|axios\|api\." src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | head -40

# 3. 인증 관련 코드 찾기
grep -rn "login\|logout\|auth\|token\|localStorage\|sessionStorage" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | head -40

# 4. Supabase 클라이언트 설정 확인
cat src/lib/supabase.ts 2>/dev/null || find src -name "supabase*" -exec cat {} \;

# 5. wrangler.toml (Engine 설정)
cat wrangler.toml 2>/dev/null

# 6. 빌드된 환경변수 확인
grep -rn "VITE_\|import.meta.env" src/ --include="*.ts" --include="*.tsx" | head -20
```

결과 보여주고 계속 진행해.

---

## Bug 1: 새로고침 시 로그인 풀림

### 원인 파악
로그인 상태를 메모리(React state)에만 저장하고 localStorage에 안 저장하는 경우.
또는 Supabase Auth를 쓰는데 session 복원을 안 하는 경우.

### 수정 방법

**Supabase Auth를 쓰는 경우:**

`src/lib/supabase.ts` 또는 클라이언트 생성 파일 확인.
`persistSession: true` (기본값)인지 확인. 기본값이면 자동으로 localStorage에 저장됨.

문제는 보통 App.tsx에서 초기 세션 복원을 안 하는 것.

`src/App.tsx` 또는 최상위 컴포넌트에서:

```typescript
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 1. 현재 세션 복원 (새로고침 시 localStorage에서 읽어옴)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // 2. 세션 변경 감지 (로그인/로그아웃/토큰 갱신)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div>로딩 중...</div>
  
  if (!session) return <LoginPage />
  
  return <MainApp />
}
```

**Supabase Auth를 안 쓰고 자체 로그인인 경우:**

로그인 성공 시 토큰을 localStorage에 저장:
```typescript
// 로그인 성공 시
localStorage.setItem('auth_token', token)
localStorage.setItem('user', JSON.stringify(user))

// 앱 초기화 시 복원
const savedToken = localStorage.getItem('auth_token')
const savedUser = localStorage.getItem('user')
if (savedToken && savedUser) {
  // 세션 복원
}

// 로그아웃 시 제거
localStorage.removeItem('auth_token')
localStorage.removeItem('user')
```

현재 코드 구조를 보고 맞는 방법으로 수정해.

---

## Bug 2: Failed to fetch

### 원인 파악

가능한 원인:
1. API URL이 잘못됨 (localhost를 바라보거나, 환경변수 누락)
2. Engine Worker가 배포 안 됨
3. CORS 오류
4. Supabase URL/Key 환경변수 누락

### 수정 방법

**Step 1: 브라우저 콘솔 확인**
- admin.madmedsales.com 접속 후 F12 → Console 탭
- 빨간 오류 메시지 전체 내용 확인
- Network 탭에서 실패한 요청 URL 확인

어떤 URL로 요청하고 있는지 파악 후 수정.

**Step 2: Supabase 직접 연결인 경우**

`.env`에 아래 있는지 확인:
```
VITE_SUPABASE_URL=https://grtkcrzgwapsjcqkxlmj.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...  (anon public 키)
```

Cloudflare Pages 환경변수에도 추가 필요:
→ Cloudflare → Pages → madmedsales → Settings → Environment variables

```
VITE_SUPABASE_URL = https://grtkcrzgwapsjcqkxlmj.supabase.co
VITE_SUPABASE_ANON_KEY = eyJ...
```

**Step 3: Engine API (Workers)를 바라보는 경우**

Engine Worker가 배포됐는지 확인:
```bash
npx wrangler deployments list
```

Engine URL 환경변수 확인:
```
VITE_API_URL=https://api.madmedsales.com
```
또는
```
VITE_ENGINE_URL=https://madmedsales-engine.workers.dev
```

Engine이 없으면 → Supabase 직접 연결로 변경하는 게 더 빠름.

**Step 4: CORS 문제인 경우**

Engine Worker의 CORS 헤더 확인:
```typescript
// Hono CORS 설정
app.use('*', cors({
  origin: ['https://admin.madmedsales.com', 'https://madmedsales.pages.dev'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))
```

`localhost`나 `*`만 허용하고 있으면 실제 도메인 추가.

---

## Phase 1: 수정 실행

Phase 0 결과를 보고 실제 원인을 파악한 뒤:

1. 로그인 유지 문제 수정
2. Failed to fetch 원인 제거

---

## Phase 2: 빌드 + 배포

```bash
npm run build
npx wrangler pages deploy dist --project-name=madmedsales
```

배포 후 확인:
- [ ] https://admin.madmedsales.com 접속
- [ ] 로그인
- [ ] F5 새로고침 → 로그인 유지됨
- [ ] 병원 목록 데이터 로딩됨 (Failed to fetch 없음)

---

## 중요: Cloudflare Pages 환경변수

빌드 시 VITE_ 환경변수가 없으면 undefined가 됨.
로컬 .env에만 있고 Cloudflare에 없으면 배포 후 깨짐.

Cloudflare → Pages → madmedsales → Settings → Environment variables 에
.env의 VITE_ 변수들 전부 추가할 것.
