# Plan: lead-communication-view

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | 관리자가 리드별 이메일 본문/카카오/데모/메모 커뮤니케이션 내용을 전혀 볼 수 없어 영업 흐름 파악이 불가능 |
| **Solution** | LeadDetail 내 탭 기반 커뮤니케이션 뷰어 — 이메일 본문 전체 + 카카오/데모/메모 이력을 시간순으로 통합 표시 |
| **Function UX Effect** | 영업관리자가 리드 1개 화면에서 모든 커뮤니케이션 히스토리를 클릭 없이 파악, 단계별 판단 속도 향상 |
| **Core Value** | Salesforce Activity Timeline 수준의 커뮤니케이션 가시성 — "무슨 말을 주고받았나"를 1초 만에 확인 |

---

## 1. 배경 및 목적

### 현재 문제
- `LeadDetail`의 `LeadTimeline`은 활동 타입·제목만 표시 (이메일 본문 없음)
- 이메일 발송 이력은 있지만 내용 확인 불가
- 카카오/데모/메모가 혼재된 타임라인만 존재
- 영업관리자가 "이 병원이랑 어떤 내용을 주고받았나"를 파악하려면 DB를 직접 봐야 함

### 목표
- 리드 상세 화면에서 **모든 커뮤니케이션 내용을 탭으로 분리, 전체 본문까지 열람** 가능하게
- 이메일 제목·본문·발송시간·열람여부 완전 표시
- Salesforce의 Activity Timeline 참조

---

## 2. 기능 범위

### In Scope
1. **LeadDetail 탭 추가**: 기존 타임라인 → 탭 구조로 교체
   - `전체` / `이메일` / `카카오` / `데모` / `메모` 탭
2. **이메일 상세 뷰**
   - 제목, 발송일시, 열람여부(opened_at), 클릭여부
   - 이메일 본문 전체 (HTML 렌더링 or 텍스트)
   - 접기/펼치기 토글
3. **카카오 이력**
   - 발송 메시지 내용, 발송시간, 답장 여부
4. **데모 이력**
   - 데모 유형, 예약일시, 완료여부, 평가 내용
5. **메모**
   - 작성자, 작성일시, 내용 전체
6. **전체 탭**
   - 모든 활동을 시간순 역순으로 통합 (이메일 본문 제외, 요약만)

### Out of Scope
- 이메일 발송 기능 (LeadActions에서 이미 처리)
- 커뮤니케이션 내용 수정/삭제
- 이메일 첨부파일

---

## 3. 데이터 소스

```
sales_lead_activities   ← 활동 타입별 이력 (email_sent, kakao_sent, note_added 등)
  - id, lead_id, activity_type, title, description, metadata JSONB, created_at

sales_emails            ← 이메일 상세 (subject, body_html, body_text, opened_at, clicked_at)
  - id, lead_id, subject, body_html, body_text, sent_at, opened_at, clicked_at

sales_demos             ← 데모 상세 (demo_type, scheduled_at, completed_at, evaluation)
  - id, lead_id, demo_type, status, scheduled_at, completed_at, notes
```

### API 엔드포인트 (engine)
- `GET /api/leads/:id/emails` — 이메일 목록 + 본문
- `GET /api/leads/:id/activities` — 기존 활동 목록 (이미 존재)
- `GET /api/leads/:id/demos` — 데모 목록 (신규 또는 기존 확인 필요)

---

## 4. UI 설계

### 탭 구조 (LeadDetail 중앙 컬럼 교체)

```
┌─────────────────────────────────────────────────────┐
│  [전체] [이메일 (3)] [카카오 (1)] [데모 (2)] [메모 (5)]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ● 이메일 발송        2026-03-15 14:30              │
│  제목: [BRITZMEDI] 울트라포머 MPT 제안서            │
│  열람: ✓ 2026-03-15 18:22 · 클릭: ✓               │
│  ┌──────────────────────────────────┐               │
│  │ 안녕하세요, 원장님.              │  [펼치기▼]    │
│  │ ...                             │               │
│  └──────────────────────────────────┘               │
│                                                     │
│  ● 메모 추가          2026-03-14 10:00              │
│  "원장 직접 통화. 기존 장비 교체 검토 중"           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 이메일 탭 카드 구조
```
┌─────────────────────────────────────────────────────┐
│  📧 이메일 #3 · 3단계                               │
│  제목: [BRITZMEDI] 울트라포머 MPT 제안서            │
│  발송: 2026-03-15 14:30  열람: ✓ 18:22  클릭: ✓   │
├─────────────────────────────────────────────────────┤
│  [이메일 본문 펼치기 ▼]                            │
│                                                     │
│  (펼쳐지면 HTML 렌더링 또는 텍스트 표시)           │
└─────────────────────────────────────────────────────┘
```

---

## 5. 구현 계획

### 파일 구조
```
apps/admin/src/
  components/leads/
    LeadCommunicationView.tsx   ← 신규 (탭 컨테이너)
    tabs/
      EmailTab.tsx              ← 이메일 목록 + 본문 뷰어
      KakaoTab.tsx              ← 카카오 이력
      DemoTab.tsx               ← 데모 이력
      NoteTab.tsx               ← 메모 목록
      AllActivityTab.tsx        ← 전체 통합 (기존 LeadTimeline 개선)
  hooks/
    use-lead-emails.ts          ← 신규 (이메일 목록 fetch)
    use-lead-demos.ts           ← 신규 또는 기존 확인
```

### LeadDetail 변경
- 중앙 컬럼의 `LeadTimeline` → `LeadCommunicationView`로 교체
- 타임라인은 `AllActivityTab` 안으로 이동

### Engine API 확인/추가
- `GET /api/leads/:id/emails` — `sales_emails` 테이블 조회
- `GET /api/leads/:id/demos` — `sales_demos` 테이블 조회

---

## 6. 우선순위

| P | 기능 | 이유 |
|---|------|------|
| P0 | 탭 구조 + 이메일 본문 뷰어 | 핵심 요구사항 |
| P0 | 메모 탭 | 기존 note_added 활동 재활용 |
| P1 | 데모 탭 | sales_demos 연동 |
| P1 | 전체 탭 (통합 타임라인) | 기존 LeadTimeline 개선 |
| P2 | 카카오 탭 | 카카오 데이터 있는 경우만 |

---

## 7. 완료 기준

- [ ] LeadDetail에서 탭 전환 가능
- [ ] 이메일 탭: 발송된 이메일 목록 + 본문 펼치기/접기
- [ ] 이메일 열람/클릭 여부 표시
- [ ] 메모 탭: 전체 메모 내용 표시
- [ ] 데모 탭: 데모 이력 표시
- [ ] 전체 탭: 시간순 통합 활동 표시
