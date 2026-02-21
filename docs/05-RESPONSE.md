# Phase 4: 반응 분석 + 자동 팔로업 + 카카오톡 (Week 9~10)

## 이 Phase의 목표

이메일 반응 데이터를 실시간 분석하여 자동 팔로업 트리거를 실행하고, 고관심 리드는 카카오톡 비즈메시지로 전환.

## 핵심 개념: 행동 기반 관심도 업데이트

```
이메일 이벤트 수신 (웹훅)
        ↓
행동 패턴 분석 (트리거 조건 체크)
        ↓
리드 관심도 자동 업데이트 (cold → warming → warm → hot)
        ↓
관심도에 따라 자동 액션:
  - warming: 시퀀스 다음 단계 가속 or 맞춤 이메일
  - warm: 카카오톡 연결 시도
  - hot: admin 즉시 알림 + 영업 배정
```

## 선행 조건

- Phase 3 완료 (이메일 발송 + 추적 작동)
- 카카오 비즈메시지 발신 프로필 등록 완료

## 완료 체크리스트

- [ ] 트리거 기반 자동 팔로업 엔진
- [ ] 관심도 자동 업데이트 로직
- [ ] 회신 분석 (AI 기반)
- [ ] 카카오 비즈메시지 연동 (알림톡)
- [ ] admin 실시간 알림 (Supabase Realtime)
- [ ] 제품별 트리거 규칙 커스터마이즈

---

## 1. Engine 코드 구조

```
apps/engine/src/
├── services/
│   └── response/
│       ├── trigger-engine.ts     # 트리거 조건 체크 + 액션 실행
│       ├── interest-updater.ts   # 관심도 자동 업데이트
│       ├── reply-analyzer.ts     # AI 회신 분석
│       └── kakao-sender.ts       # 카카오 비즈메시지
├── routes/
│   ├── tracking.ts               # 클릭 추적 리다이렉트
│   └── kakao.ts                  # 카카오 API
```

---

## 2. 트리거 조건 + 자동 액션

### 이메일 행동 트리거

| 패턴 | 의미 | 관심도 | 자동 액션 |
|------|------|--------|----------|
| 3회+ 오픈, 0 클릭 | 관심은 있으나 확신 없음 | warming | 해당 제품 사례 이메일 발송 |
| 제품 페이지 클릭 | 제품 정보 탐색 중 | warming | 시퀀스 다음 단계 1일 앞당김 |
| 데모 페이지 방문 | 데모 의향 | warm | "15분 온라인 데모" 이메일 |
| 가격 페이지 2회+ | 구매 고려 중 | warm | 결제 조건/할인 이메일 |
| 긍정 회신 | 관심 확인 | hot | 시퀀스 중단 + 카카오 전환 + admin 알림 |
| 질문 회신 | 정보 필요 | warm | AI 답변 초안 → admin 검토 → 발송 |
| 부정 회신 | 거절 | cold | 시퀀스 중단 + 3개월 후 재접근 예약 |
| 수신거부 | 연락 거부 | - | 즉시 중단 + 기록 |

### 제품 유형별 트리거 차이

```typescript
/**
 * 고가 장비 (TORR RF 등):
 * - 트리거 반응 속도: 느리게 (3회 오픈 후 액션)
 * - 데모 유도 적극적
 * - 가격 직접 언급 안 함
 * 
 * 소모품 (2mm 바늘 등):
 * - 트리거 반응 속도: 빠르게 (1회 클릭 즉시 견적)
 * - 데모 불필요
 * - 가격 바로 안내
 * 
 * 중가 장비:
 * - 고가와 소모품의 중간
 */
```

---

## 3. 관심도 자동 업데이트

```typescript
function calculateInterestLevel(lead: Lead, events: EmailEvent[]): InterestLevel {
  let score = 0;

  // 이메일 반응 기반
  score += lead.open_count * 3;
  score += lead.click_count * 10;
  score += lead.reply_count * 30;
  
  // 페이지 방문 기반
  score += lead.demo_page_visits * 20;
  score += lead.price_page_visits * 15;
  score += lead.product_page_visits * 8;

  // 시간 가중치 (최근 반응일수록 높은 점수)
  const daysSinceLastActivity = getDaysSince(getLastActivityDate(events));
  if (daysSinceLastActivity <= 1) score *= 1.5;
  else if (daysSinceLastActivity <= 3) score *= 1.2;
  else if (daysSinceLastActivity > 14) score *= 0.5;

  // 관심도 판정
  if (score >= 80) return 'hot';
  if (score >= 40) return 'warm';
  if (score >= 15) return 'warming';
  return 'cold';
}
```

---

## 4. AI 회신 분석

```typescript
const REPLY_ANALYSIS_PROMPT = `
한국 피부과/성형외과 병원에서 온 이메일 회신을 분석하세요.

## 우리가 보낸 이메일 (맥락)
제품: {{product_name}}
단계: {{step_number}} / {{total_steps}}
내용 요약: {{our_email_summary}}

## 병원의 회신
{{reply_content}}

## 분석 (JSON)
{
  "sentiment": "positive | neutral | negative | question",
  "intent": "interested | want_demo | want_price | want_info | not_now | not_interested | already_have | forwarded",
  "urgency": "immediate | soon | later | none",
  "key_questions": ["질문이 있다면 정리"],
  "recommended_action": "다음 행동 추천 (한국어 2~3문장)",
  "auto_reply_possible": true/false,
  "draft_reply": "자동 회신 가능하면 초안 (200자 이내)"
}
`;
```

---

## 5. 카카오 비즈메시지

### 연동 시점

```
이메일에서 "warm" 이상 관심도 + 긍정 회신 시:
→ 카카오톡으로 전환 제안 이메일 발송
→ 수락하면 알림톡/친구톡으로 대화 시작
```

### 알림톡 템플릿 (제품별로 다른 내용)

```typescript
const ALIMTALK_TEMPLATES = {
  demo_invitation: {
    code: 'DEMO_INVITE',
    template: `
[MADMEDSALES] {{product_name}} 데모 안내

{{hospital_name}} 원장님, 안녕하세요.

{{product_name}}에 관심 가져주셔서 감사합니다.
15분 온라인 데모를 준비했습니다.

▶ 데모 신청하기
{{demo_url}}

문의: hello@madmedsales.com
`,
  },
  price_info: { /* 소모품용 가격 안내 */ },
  followup: { /* 데모 후 팔로업 */ },
};
```

---

## 6. 영업 배정 로직

```typescript
/**
 * HOT 리드 발생 시:
 * 1. admin에 실시간 알림 (Supabase Realtime)
 * 2. assigned_to가 비어있으면 → 수동 배정 대기
 * 3. 배정 후 → 영업 담당자에게 카카오/이메일 알림
 * 
 * 배정 시 제공 정보:
 * - 리드 카드 (병원 프로파일 + 제품 매칭 분석)
 * - 이메일 히스토리 전체
 * - AI 추천 접근법
 * - 이전 커뮤니케이션 요약
 */
```

---

## 7. 재접근 스케줄링

```typescript
/**
 * 부정 회신 or 시퀀스 완료 후 무반응:
 * 
 * 1차 재접근: 3개월 후 (업데이트 메일)
 * 2차 재접근: 6개월 후 (신제품 또는 프로모션)
 * 3차 이후: 재접근 안 함 (완전 제외)
 * 
 * 신제품 출시 시: 해당 제품과 매칭이 높은 nurturing 리드 자동 재활성화
 */
```

---

## 8. API

```typescript
/**
 * GET  /api/tracking/:emailId/open    - 오픈 추적 (투명 픽셀)
 * GET  /api/tracking/:emailId/click   - 클릭 추적 (리다이렉트)
 * 
 * POST /api/leads/:id/reply           - 회신 분석 요청
 * PUT  /api/leads/:id/interest        - 관심도 수동 변경
 * PUT  /api/leads/:id/assign          - 영업 배정
 * 
 * POST /api/kakao/send                - 카카오 메시지 발송
 * GET  /api/kakao/templates           - 알림톡 템플릿 목록
 * 
 * GET  /api/leads/hot                 - HOT 리드 목록 (admin 알림용)
 * GET  /api/leads/triggers            - 최근 트리거 발동 로그
 */
```

---

## 이 Phase 완료 후 상태

- 이메일 반응 기반 자동 팔로업 작동
- 리드 관심도 실시간 자동 업데이트
- AI 회신 분석 + 답변 초안 생성
- 카카오 비즈메시지 연동 완료
- HOT 리드 → admin 실시간 알림
- 영업 배정 프로세스 작동
- → 다음: `06-DEMO-CRM.md`
