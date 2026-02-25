# CRM 메뉴 + 병원 목록 페이지 추가

아래를 전부 순서대로 실행해. 중간에 멈추지 마.

---

## Phase 0: 현재 구조 파악

```bash
# 프로젝트 전체 구조 확인
find src -type f -name "*.tsx" -o -name "*.jsx" -o -name "*.ts" | sort

# 사이드바 컴포넌트 찾기
grep -rn "사이드바\|Sidebar\|sidebar\|NavItem\|MenuItem" src/ --include="*.tsx" --include="*.jsx" -l

# 라우터 설정 확인
cat src/App.tsx 2>/dev/null || cat src/main.tsx 2>/dev/null || cat src/router.tsx 2>/dev/null

# Supabase 클라이언트 설정 확인
grep -rn "supabase\|createClient" src/ --include="*.ts" --include="*.tsx" -l

# 환경변수 확인
cat .env 2>/dev/null || cat .env.local 2>/dev/null
```

결과 먼저 보여줘.

---

## Phase 1: Supabase 클라이언트 확인 및 설정

Supabase 클라이언트가 없으면 만들어.

파일: `src/lib/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// CRM 타입 정의
export interface CrmHospital {
  id: string
  name: string
  branch_name: string | null
  address: string | null
  region: string | null
  district: string | null
  phone: string | null
  email: string | null
  customer_grade: 'VIP' | 'A' | 'B' | 'C'
  health_status: 'green' | 'yellow' | 'orange' | 'red'
  health_score: number
  report_enabled: boolean
  notes: string | null
  last_contacted_at: string | null
  created_at: string
  updated_at: string
  // 조인 데이터
  crm_contacts?: CrmContact[]
  crm_equipment?: CrmEquipment[]
  crm_franchises?: CrmFranchise
}

export interface CrmContact {
  id: string
  hospital_id: string
  name: string
  role: string
  is_primary: boolean
  phone: string | null
  email: string | null
  preferred_contact: string
}

export interface CrmEquipment {
  id: string
  hospital_id: string
  serial_number: string | null
  model_variant: string | null
  delivered_at: string | null
  warranty_end: string | null
  status: 'active' | 'repairing' | 'sold' | 'disposed'
  notes: string | null
  crm_products?: { name: string }
}

export interface CrmFranchise {
  id: string
  name: string
  total_branches: number
  equipped_branches: number
}
```

@supabase/supabase-js가 설치 안 돼 있으면:
```bash
npm install @supabase/supabase-js
```

.env에 아래 추가 (없으면):
```
VITE_SUPABASE_URL=https://grtkcrzgwapsjcqkxlmj.supabase.co
VITE_SUPABASE_ANON_KEY=[Supabase Settings > API > anon public 키]
```

---

## Phase 2: 사이드바에 CRM 메뉴 추가

사이드바 컴포넌트를 찾아서 기존 메뉴 구조를 파악하고,
🏥 CRM 섹션을 추가해. 위치는 "영업 자동화" 아래.

추가할 메뉴 구조:
```
🏥 CRM
  ├── 고객 대시보드      /crm
  ├── 병원 관리          /crm/hospitals
  ├── 장비/소모품        /crm/equipment    (준비중 badge)
  ├── 활동 기록          /crm/activities   (준비중 badge)
  └── MADMEDCHECK 리포트 /crm/reports      (준비중 badge)
```

기존 사이드바 코드 스타일에 맞춰서 추가할 것.
"준비중" 항목은 disabled 처리 (클릭 안 되고, 뱃지 표시).

---

## Phase 3: 라우터에 CRM 경로 추가

App.tsx (또는 router 파일)에 CRM 관련 경로 추가:

```
/crm           → CrmDashboard (Phase 4에서 구현, 일단 placeholder)
/crm/hospitals → CrmHospitals (★ 이번에 구현)
/crm/hospitals/:id → CrmHospitalDetail (placeholder)
```

---

## Phase 4: 병원 목록 페이지 구현

파일: `src/pages/crm/CrmHospitals.tsx`

### 기능 요구사항:

**상단 통계 카드 4개:**
- 전체 병원수
- 이번달 접촉 (last_contacted_at이 30일 이내)
- 주의 필요 (last_contacted_at이 90일 이상 OR health_status가 orange/red)
- S/N 미확인 (notes에 'S/N 미확인' 포함)

**필터/검색 바:**
- 텍스트 검색 (병원명, 원장명으로 검색)
- 지역 드롭다운 (region 기준, 전체/서울/경기/부산/대구/... )
- 등급 드롭다운 (전체/VIP/A/B/C)
- 상태 드롭다운 (전체/정상/주의/위험)

**병원 목록 테이블:**

| 컬럼 | 내용 |
|------|------|
| 병원명 | name + branch_name, 클릭 시 상세로 이동 |
| 원장 | crm_contacts에서 is_primary=true인 것의 name |
| 지역 | district (없으면 region) |
| 등급 | VIP/A/B/C 뱃지 (색상 다르게) |
| 상태 | 🟢🟡🟠🔴 아이콘 + 텍스트 |
| 납품 장비 | crm_equipment count + 모델 |
| 마지막 접촉 | last_contacted_at 상대시간 (예: 3개월 전) |
| 비고 | notes (S/N 미확인 등) |

**데이터 로딩:**
```typescript
// Supabase 쿼리 (anon key는 RLS 때문에 tenant_id 자동 필터)
// 현재는 service_role이 없으니 일단 RLS bypass용 별도 처리 필요
// 임시방편: supabase 클라이언트에 service_role key 사용 (admin에서만)

const { data, error } = await supabase
  .from('crm_hospitals')
  .select(`
    *,
    crm_contacts(id, name, role, is_primary, phone),
    crm_equipment(id, model_variant, serial_number, status, delivered_at,
      crm_products(name)
    )
  `)
  .order('name')
```

**주의:** RLS 때문에 anon key로는 데이터가 안 보일 수 있어.
그러면 .env에 VITE_SUPABASE_SERVICE_KEY 추가하고,
admin 전용 supabase 클라이언트를 별도로 만들어서 사용:
```typescript
// src/lib/supabaseAdmin.ts
export const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_KEY  // service_role key
)
```

**UI 스타일:**
- 기존 admin 페이지 다크 테마 스타일에 맞출 것
- 로딩 스피너
- 빈 상태 (데이터 없음) UI
- 에러 상태 UI

---

## Phase 5: CRM 대시보드 (placeholder)

파일: `src/pages/crm/CrmDashboard.tsx`

간단하게만 만들어. 나중에 채울 거야.

```
┌─────────────────────────────────────────────┐
│  🏥 CRM 대시보드                              │
│                                             │
│  [69개 병원]  [67명 원장]  [69개 장비]        │
│                                             │
│  ⚠️ 아직 대시보드를 구성 중입니다.             │
│  병원 목록에서 데이터를 확인하세요.            │
│  [병원 목록 보기 →]                           │
└─────────────────────────────────────────────┘
```

---

## Phase 6: 빌드 확인 + 배포

```bash
npm run build
```

빌드 성공하면:
```bash
npx wrangler pages deploy dist --project-name=madmedsales-admin
```

또는 기존 배포 방법 확인 후 그대로 사용.

---

## 완료 조건

- [ ] 사이드바에 🏥 CRM 메뉴 보임
- [ ] /crm 로 이동하면 대시보드 placeholder 보임
- [ ] /crm/hospitals 로 이동하면 병원 목록 테이블 보임
- [ ] 테이블에 69개 병원 데이터 로딩됨
- [ ] 검색/필터 동작
- [ ] 빌드 성공 + 배포 완료

---

## 주의사항

- RLS 때문에 데이터 안 보이면 service_role key 사용 (admin 전용이라 OK)
- 기존 코드 스타일 (색상, 폰트, 간격) 맞출 것
- TypeScript 오류 0개로 빌드
- 안 되는 부분은 솔직하게 보고하고 나머지 계속 진행
