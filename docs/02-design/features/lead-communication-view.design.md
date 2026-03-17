# Design: lead-communication-view

## 1. 현황 분석

### 기존 코드 상태

| 파일 | 역할 | 문제 |
|------|------|------|
| `components/leads/LeadDetail.tsx` | 리드 상세 (3컬럼 레이아웃) | 중앙컬럼에 LeadTimeline만 있음 |
| `components/leads/LeadTimeline.tsx` | 활동 타임라인 | 제목/설명만 표시, 이메일 본문 없음 |
| `hooks/use-leads.ts` | 리드 데이터 훅 | `useLeadActivities`만 있음 |

### 기존 Engine API

| 엔드포인트 | 현황 |
|-----------|------|
| `GET /api/leads/:id/activities` | ✅ 존재 — `sales_lead_activities` 조회 |
| `GET /api/emails?lead_id=xxx` | ✅ 존재 — but body_html/body_text 미포함 |
| `GET /api/emails/:id` | ✅ 존재 — 이메일 전체 + events 포함 |
| `GET /api/demos?lead_id=xxx` | ✅ 존재 (확인) |
| `GET /api/leads/:id/emails` | ❌ 없음 — 신규 추가 필요 |

---

## 2. 구현 범위 확정

### 신규 API (Engine)
- `GET /api/leads/:id/emails` — 해당 리드의 이메일 목록 (body_html 포함)

### 신규 훅 (Admin)
- `hooks/use-lead-emails.ts` — 이메일 목록 fetch
- `hooks/use-lead-demos.ts` — 데모 목록 fetch (기존 demos route 활용)

### 신규 컴포넌트 (Admin)
- `components/leads/LeadCommunicationView.tsx` — 탭 컨테이너
- `components/leads/tabs/EmailTab.tsx` — 이메일 본문 뷰어
- `components/leads/tabs/DemoTab.tsx` — 데모 이력
- `components/leads/tabs/NoteTab.tsx` — 메모 목록
- `components/leads/tabs/AllActivityTab.tsx` — 통합 타임라인 (LeadTimeline 개선)

### 변경 (Admin)
- `components/leads/LeadDetail.tsx` — 중앙 컬럼의 LeadTimeline → LeadCommunicationView 교체

---

## 3. 컴포넌트 설계

### LeadCommunicationView

```typescript
// components/leads/LeadCommunicationView.tsx
interface LeadCommunicationViewProps {
  leadId: string;
}

// 탭 정의
type TabId = 'all' | 'email' | 'kakao' | 'demo' | 'note';

interface Tab {
  id: TabId;
  label: string;
  count?: number;
}
```

**렌더링:**
```
┌────────────────────────────────────────────────────┐
│  전체(12)  이메일(3)  카카오(1)  데모(2)  메모(6)  │ ← 탭바
├────────────────────────────────────────────────────┤
│  [선택된 탭 컨텐츠]                                 │
└────────────────────────────────────────────────────┘
```

**카운트**: 각 탭은 해당 타입 아이템 수 표시. 로딩 중이면 숫자 없이 탭명만.

---

### EmailTab

```typescript
// components/leads/tabs/EmailTab.tsx
interface Email {
  id: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: string;
  sent_at: string | null;
  step_number: number | null;
  opened_at: string | null;   // email_events에서 파생
  clicked_at: string | null;  // email_events에서 파생
}
```

**이메일 카드 UI:**
```
┌─────────────────────────────────────────────────────┐
│  📧 Step 2 이메일                    2026-03-15 14:30 │
│  제목: [BRITZMEDI] 울트라포머 MPT 제안서              │
│  상태: 발송됨  열람: ✓ 18:22  클릭: ✓               │
├─────────────────────────────────────────────────────┤
│  [본문 펼치기 ▼]                                    │
│                                                     │
│  (펼쳐지면 body_html iframe 렌더링                  │
│   또는 body_text whitespace-pre-wrap)               │
└─────────────────────────────────────────────────────┘
```

**구현 포인트:**
- `expandedId` state로 접기/펼치기 관리
- body_html이 있으면 `<div dangerouslySetInnerHTML>` 렌더링 (XSS 위험 낮음 — 자체 생성 HTML)
- body_html 없으면 body_text를 `whitespace-pre-wrap`으로 표시
- 열람여부: `opened_at` 필드로 표시 (API에서 email_events join)

---

### DemoTab

```typescript
interface Demo {
  id: string;
  demo_type: 'visit' | 'online' | 'self_video';
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
}
```

**데모 카드 UI:**
```
┌─────────────────────────────────────────────────────┐
│  🏥 방문 데모                        2026-03-20 예정 │
│  상태: 예정  완료: -                                │
│  메모: "원장 직접 요청. 오전 10시 방문"             │
└─────────────────────────────────────────────────────┘
```

---

### NoteTab

활동 목록에서 `activity_type === 'note_added'`인 항목만 필터링.
별도 API 불필요 — `useLeadActivities` 재사용.

```
┌─────────────────────────────────────────────────────┐
│  📝 메모                             2026-03-14 10:00 │
│  원장 직접 통화. 기존 장비 교체 검토 중             │
└─────────────────────────────────────────────────────┘
```

---

### AllActivityTab

기존 `LeadTimeline` 개선판. 이메일 카드에서는 제목만 표시 (본문 미표시).

```typescript
// activity_type별 아이콘 매핑
const ACTIVITY_ICONS: Record<string, string> = {
  email_sent: '📧',
  email_opened: '👁',
  email_clicked: '🖱',
  kakao_sent: '💬',
  demo_requested: '🏥',
  demo_completed: '✅',
  note_added: '📝',
  stage_changed: '→',
};
```

---

## 4. API 설계 (Engine 신규)

### GET /api/leads/:id/emails

```typescript
// apps/engine/src/routes/leads.ts 에 추가
app.get('/:id/emails', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from(T.emails)
    .select(`
      id, lead_id, subject, body_html, body_text,
      status, sent_at, step_number, created_at,
      sales_email_events(event_type, created_at)
    `)
    .eq('lead_id', id)
    .order('created_at', { ascending: false });

  // opened_at, clicked_at 파생
  const emails = (data ?? []).map((email) => {
    const events = email.sales_email_events ?? [];
    return {
      ...email,
      opened_at: events.find((e) => e.event_type === 'opened')?.created_at ?? null,
      clicked_at: events.find((e) => e.event_type === 'clicked')?.created_at ?? null,
      sales_email_events: undefined,
    };
  });

  return c.json({ success: true, data: { emails } });
});
```

---

## 5. 훅 설계 (Admin)

### hooks/use-lead-emails.ts

```typescript
import { useApi } from './use-api';

interface LeadEmail {
  id: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: string;
  sent_at: string | null;
  step_number: number | null;
  opened_at: string | null;
  clicked_at: string | null;
}

interface LeadEmailsResult {
  emails: LeadEmail[];
}

export function useLeadEmails(leadId: string | undefined): ReturnType<typeof useApi<LeadEmailsResult>> {
  return useApi<LeadEmailsResult>(leadId ? `/api/leads/${leadId}/emails` : null);
}
```

### hooks/use-lead-demos.ts

```typescript
import { useApi } from './use-api';

interface LeadDemo {
  id: string;
  demo_type: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface LeadDemosResult {
  demos: LeadDemo[];
}

export function useLeadDemos(leadId: string | undefined): ReturnType<typeof useApi<LeadDemosResult>> {
  return useApi<LeadDemosResult>(leadId ? `/api/demos?lead_id=${leadId}` : null);
}
```

---

## 6. LeadDetail 변경 내용

```typescript
// LeadDetail.tsx 중앙 컬럼 변경
// Before:
<div className="rounded-lg border bg-white p-5">
  <h3 className="mb-3 text-sm font-semibold text-gray-700">타임라인</h3>
  {id && <LeadTimeline leadId={id} />}
</div>

// After:
{id && <LeadCommunicationView leadId={id} />}
```

---

## 7. 구현 순서

1. **Engine**: `GET /api/leads/:id/emails` 엔드포인트 추가 (`leads.ts`)
2. **Admin hooks**: `use-lead-emails.ts`, `use-lead-demos.ts` 생성
3. **Admin tabs**: `AllActivityTab.tsx` (LeadTimeline 개선) → `EmailTab.tsx` → `NoteTab.tsx` → `DemoTab.tsx`
4. **Admin container**: `LeadCommunicationView.tsx` 탭 컨테이너
5. **Admin LeadDetail**: LeadTimeline → LeadCommunicationView 교체

---

## 8. 타입 정의

```typescript
// packages/shared/src/types/ 또는 admin 로컬에 추가
export interface LeadEmail {
  id: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: string;
  sent_at: string | null;
  step_number: number | null;
  opened_at: string | null;
  clicked_at: string | null;
}

export interface LeadDemo {
  id: string;
  demo_type: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
}
```

---

## 9. 완료 기준 (체크리스트)

- [ ] Engine: `GET /api/leads/:id/emails` 응답에 body_html, opened_at, clicked_at 포함
- [ ] Admin: `useLeadEmails`, `useLeadDemos` 훅 동작
- [ ] Admin: 탭 전환 시 해당 탭 컨텐츠만 렌더링
- [ ] Admin: 이메일 본문 펼치기/접기 동작
- [ ] Admin: 이메일 열람·클릭 여부 뱃지 표시
- [ ] Admin: 메모 탭에 note_added 활동만 필터링 표시
- [ ] Admin: 데모 탭에 해당 리드 데모 이력 표시
- [ ] Admin: LeadDetail 빌드 에러 없음
