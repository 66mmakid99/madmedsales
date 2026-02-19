# Phase 4: 반응 분석 + 자동 팔로업 + 카카오톡 (Week 9~10)

## 이 Phase의 목표

이메일 반응 패턴을 AI가 분석하고, 자동으로 최적의 다음 액션을 실행. 관심 리드를 카카오톡으로 전환.

## 선행 조건

- Phase 3 완료 (이메일 발송 + 오픈/클릭 추적 작동)
- 실전 발송 데이터 누적 (최소 50건+)
- 카카오 비즈니스 채널 개설 + 알림톡 템플릿 심사 신청 (2주 전에 미리!)

## 완료 체크리스트

- [ ] 반응 패턴 분석 엔진 (트리거 조건 + 자동 액션)
- [ ] AI 회신 분석 (Claude API)
- [ ] 관심도 자동 업데이트 (cold → warming → warm → hot)
- [ ] 카카오 비즈메시지 연동 (알림톡)
- [ ] 이메일 → 카카오톡 전환 플로우
- [ ] 자동 팔로업 + 트리거 작동 확인

---

## 1. Engine 코드 구조 (이 Phase)

```
apps/engine/src/
├── routes/
│   └── kakao.ts               # 카카오톡 API
├── services/
│   ├── ai/
│   │   ├── responseAnalyzer.ts # 반응 패턴 분석
│   │   └── prompts/
│   │       ├── replyAnalysis.ts  # 회신 분석 프롬프트
│   │       └── followup.ts      # 팔로업 프롬프트
│   ├── kakao/
│   │   ├── bizMessage.ts      # 카카오 비즈메시지
│   │   └── templates.ts       # 알림톡 템플릿
│   └── automation/
│       ├── triggerEngine.ts   # 트리거 조건 엔진
│       └── actionExecutor.ts  # 자동 액션 실행
```

---

## 2. 반응 패턴 분석 + 자동 트리거

### 트리거 조건 테이블

```
┌─────────────────────────────────┬──────────────────────────────────────────┐
│ 트리거 조건                      │ 자동 액션                                 │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 오픈 3회+ & 클릭 0회             │ → "관심은 있지만 확신 부족"                │
│ ("읽긴 읽는데 행동은 안 함")      │   임상 데이터 + 유사 병원 사례 이메일      │
│                                 │   interest_level → 'warming'              │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 데모 페이지 방문 + 이탈          │ → "보고 싶지만 부담"                       │
│ (demo_page_visits >= 1)         │   "15분 온라인, 부담 없이" 재제안 이메일    │
│                                 │   interest_level → 'warm'                 │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 가격 페이지 반복 방문             │ → "사고 싶지만 가격 고민"                  │
│ (price_page_visits >= 2)        │   렌탈/할부 옵션 + ROI 시뮬레이션 이메일   │
│                                 │   interest_level → 'warm'                 │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 비교 페이지 방문                 │ → "다른 장비와 비교 중"                    │
│ (clicked_page = 'comparison')   │   TORR RF vs 경쟁사 비교 자료 이메일       │
│                                 │   interest_level → 'warm'                 │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 긍정적 회신                      │ → "관심 확인!"                            │
│ (reply sentiment = positive)    │   즉시 카카오톡 전환 제안 + 데모 제안       │
│                                 │   시퀀스 일시정지                          │
│                                 │   interest_level → 'hot'                  │
│                                 │   관리자 알림 발송                          │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 질문 회신                        │ → "추가 정보 필요"                        │
│ (reply sentiment = question)    │   AI가 답변 초안 생성 → admin 검토 후 발송  │
│                                 │   시퀀스 일시정지                          │
│                                 │   interest_level → 'warm'                 │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 거절 회신 ("지금은 아닙니다")     │ → "타이밍 불일치, 미래 가능"              │
│ (reply sentiment = negative,    │   정중한 마무리 이메일                     │
│  type = 'timing')               │   3개월 뒤 재접근 스케줄 설정              │
│                                 │   stage → 'nurturing'                     │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 거절 회신 ("필요 없습니다")       │ → "현재 니즈 없음"                       │
│ (reply sentiment = negative,    │   마무리 이메일                            │
│  type = 'no_need')              │   월간 뉴스레터 리스트로 전환              │
│                                 │   stage → 'nurturing'                     │
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 시퀀스 완료 + 전체 무반응         │ → "관심 없음"                            │
│ (sequence done, no events)      │   장기 육성 리스트                         │
│                                 │   stage → 'nurturing'                     │
│                                 │   월 1회 뉴스레터만 발송                   │
└─────────────────────────────────┴──────────────────────────────────────────┘
```

### 트리거 엔진 구현

```typescript
// services/automation/triggerEngine.ts

interface TriggerRule {
  id: string;
  name: string;
  conditions: TriggerCondition[];  // AND 조건
  actions: TriggerAction[];
}

interface TriggerCondition {
  field: string;       // 'open_count', 'click_count', 'demo_page_visits', etc
  operator: 'gte' | 'lte' | 'eq' | 'gt' | 'lt';
  value: number | string;
}

interface TriggerAction {
  type: 'send_email' | 'update_interest' | 'update_stage' | 
        'kakao_connect' | 'notify_admin' | 'schedule_reapproach' | 
        'pause_sequence';
  params: Record<string, any>;
}

/**
 * Cron: 매 1시간마다 실행
 * 
 * 1. 최근 1시간 내 이벤트가 있는 리드 조회
 * 2. 각 리드에 대해 모든 트리거 룰 검사
 * 3. 매칭되는 룰의 액션 실행
 * 4. 실행 결과 lead_activities에 기록
 * 5. 같은 트리거가 같은 리드에 중복 실행 방지 (쿨다운)
 */
```

---

## 3. AI 회신 분석

### 회신 수신 방법

```
방법 1: Resend Reply-To
- reply-to를 hello@madmedsales.com으로 설정
- Resend Inbound Email 기능으로 수신 → 웹훅 발송
- POST /api/webhooks/email-reply

방법 2: 별도 메일 수신 서비스
- 필요 시 별도 구축 (1차에서는 방법 1 추천)
```

### 회신 분석 프롬프트

```typescript
// prompts/replyAnalysis.ts

export const REPLY_ANALYSIS_PROMPT = `
다음은 TORR RF 영업 이메일에 대한 원장의 회신입니다.
이 회신을 분석하세요.

## 우리가 보낸 이메일
제목: {{our_email_subject}}
내용 요약: {{our_email_summary}}

## 원장 회신
{{reply_content}}

## 분석 항목
JSON으로 응답:
{
  "sentiment": "positive | neutral | negative | question",
  "purchase_intent": "high | medium | low | none",
  "reply_type": "interest | question | timing | no_need | price_concern | other",
  "key_concern": "원장이 가장 신경쓰는 것 (1문장)",
  "summary": "회신 핵심 내용 요약 (1문장)",
  "recommended_response": "추천 대응 방향 (2~3문장)",
  "should_connect_kakao": true/false,
  "should_notify_admin": true/false,
  "urgency": "immediate | within_day | within_week | no_rush"
}
`;
```

### 회신 처리 플로우

```typescript
/**
 * POST /api/webhooks/email-reply (Resend Inbound)
 * 
 * 1. 발신자 이메일로 lead 매칭
 * 2. 회신 내용 추출 (인용문 제거)
 * 3. Claude API로 회신 분석
 * 4. 분석 결과에 따른 자동 처리:
 * 
 *    sentiment=positive + purchase_intent=high
 *    → stage='responded', interest='hot'
 *    → 카카오톡 전환 제안 이메일 자동 발송
 *    → 관리자 즉시 알림 (카카오톡)
 *    → 시퀀스 일시정지
 * 
 *    sentiment=question
 *    → AI가 답변 초안 생성
 *    → admin 대시보드에 "검토 필요" 표시
 *    → 관리자가 수정 후 발송 (또는 그대로 발송)
 *    → 시퀀스 일시정지
 * 
 *    sentiment=negative
 *    → reply_type에 따라 분기 (위 트리거 테이블 참조)
 * 
 * 5. lead_activities에 기록
 * 6. leads.reply_count++, last_replied_at 업데이트
 */
```

---

## 4. 관심도(Interest Level) 자동 업데이트

```typescript
/**
 * 관심도 계산 로직
 * 
 * cold (기본): 아무 반응 없음
 * warming: 오픈 1~2회 또는 클릭 없는 오픈 3회+
 * warm: 클릭 1회+ 또는 질문 회신 또는 페이지 방문
 * hot: 긍정 회신 또는 데모 신청 또는 높은 구매 의향
 */

function calculateInterestLevel(lead: Lead): string {
  // hot 조건
  if (lead.reply_count > 0 && lastReplyPositive(lead)) return 'hot';
  if (lead.demo_page_visits >= 2) return 'hot';
  
  // warm 조건
  if (lead.click_count >= 1) return 'warm';
  if (lead.price_page_visits >= 1) return 'warm';
  if (lead.reply_count > 0) return 'warm'; // 질문이든 뭐든 회신 자체가 warm
  
  // warming 조건
  if (lead.open_count >= 1) return 'warming';
  
  return 'cold';
}
```

---

## 5. 카카오 비즈메시지 연동

### 사전 준비 (이 Phase 시작 2주 전에!)

```
1. 카카오 비즈니스 채널 개설
   - 채널명: MADMEDSALES (또는 마드메드세일즈)
   - 카테고리: 의료기기/의료서비스
   
2. 알림톡 템플릿 등록 (카카오 심사 1~2주)
   - 데모 확인 템플릿
   - 데모 리마인더 템플릿
   - 자료 발송 템플릿
   - 견적서 발송 템플릿
   
3. API 연동 키 발급
   - 발신프로필 키 (Sender Key)
   - API 키
```

### 알림톡 템플릿 (심사용 원문)

```
[템플릿 1: 데모 확인]
템플릿 코드: DEMO_CONFIRM
카테고리: 예약/방문 확인

내용:
#{병원명} 원장님, 안녕하세요.
MADMEDSALES입니다.

TORR RF 데모 일정이 확정되었습니다.

■ 일시: #{날짜} #{시간}
■ 방식: #{방식}
■ 담당: #{담당자}

궁금하신 점은 아래 버튼으로 문의해주세요.

버튼:
[문의하기] (채널 채팅)
[일정 변경] (URL)

---

[템플릿 2: 데모 리마인더]
템플릿 코드: DEMO_REMINDER

내용:
#{병원명} 원장님, 안녕하세요.
내일 #{시간}에 TORR RF 데모가 예정되어 있습니다.

원장님 병원 맞춤 자료를 준비했습니다.
■ ROI 시뮬레이션
■ 시술 조합 제안서
■ TORR RF 임상 데이터

버튼:
[데모 참석 확인] (URL)
[일정 변경] (URL)

---

[템플릿 3: 자료 발송]
템플릿 코드: MATERIAL_SEND

내용:
#{병원명} 원장님, 안녕하세요.
요청하신 자료를 보내드립니다.

■ #{자료명}

아래 버튼을 눌러 확인해주세요.

버튼:
[자료 보기] (URL)
[추가 문의] (채널 채팅)
```

### 카카오 비즈메시지 서비스

```typescript
// services/kakao/bizMessage.ts

interface AlimtalkRequest {
  templateCode: string;
  recipientNumber: string;  // 010-xxxx-xxxx
  templateParams: Record<string, string>;
  buttons?: {
    type: 'WL' | 'AL' | 'BK';  // 웹링크, 앱링크, 봇키워드
    name: string;
    linkMobile?: string;
    linkPc?: string;
  }[];
}

async function sendAlimtalk(request: AlimtalkRequest): Promise<void> {
  // 카카오 알림톡 API 호출
  // POST https://api-alimtalk.kakao.com/v2/sender/send
  
  // 주의:
  // - 전화번호 필수 (이메일만으로는 발송 불가)
  // - 알림톡은 수신 동의 불필요 (정보성 메시지)
  // - 광고성은 친구톡 사용 (채널 추가 필요)
  // - 야간 발송 제한 (20:50~08:00)
}
```

### 이메일 → 카카오톡 전환 플로우

```
전환 트리거: 
- 긍정적 회신
- 데모 신청
- 오픈 3회+ & 클릭 1회+

전환 방법:
1. 이메일에 카카오톡 채널 추가 링크 포함
   "더 빠른 상담은 카카오톡으로! [채널 추가하기]"
   URL: https://pf.kakao.com/{channelId}

2. 채널 추가 감지 → lead.kakao_connected = true
   (카카오 콜백 or 주기적 확인)

3. 환영 알림톡 자동 발송
   "원장님, MADMEDSALES 채널 추가 감사합니다.
    앞으로 TORR RF 관련 자료와 상담을 카카오톡으로 보내드리겠습니다."

4. 이후 커뮤니케이션: 이메일 → 카카오톡 우선

주의:
- 카카오톡 전환에는 전화번호가 필요
- 이메일만 있고 전화번호 없는 리드 → 이메일 내에서 전화번호 요청
- 회신에서 전화번호 추출 → lead에 업데이트 → 카카오톡 발송
```

---

## 6. 관리자 알림

```
관리자에게 즉시 알림을 보내야 하는 상황:

- 긍정적 회신 수신 (hot 리드)
- 데모 신청 접수
- 높은 구매 의향 회신
- AI가 대응 불확실한 회신 (검토 필요)
- 이메일 대량 바운스 발생 (도메인 문제)

알림 채널:
- 1순위: 카카오톡 (MADMEDSALES 채널에서 관리자 본인에게)
- 2순위: 이메일
```

---

## 7. 카카오톡 API

### routes/kakao.ts

```typescript
/**
 * POST /api/kakao/send-alimtalk
 * - body: { lead_id, template_code, params }
 * - 알림톡 발송
 * 
 * POST /api/kakao/send-welcome
 * - body: { lead_id }
 * - 채널 추가 환영 메시지
 * 
 * GET /api/kakao/messages
 * - 카카오톡 메시지 이력 (lead_id 필터)
 * 
 * POST /api/webhooks/kakao
 * - 카카오 콜백 수신 (채널 추가/삭제, 메시지 수신)
 */
```

---

## 8. 스테이지별 커뮤니케이션 톤

```
첫 접촉 (contacted):
→ 전문적 + 예의 바른 톤
→ "원장님, 안녕하세요. MADMEDSALES의 OOO입니다."

관심 확인 후 (responded):
→ 친근한 + 구체적인 톤
→ "원장님, 보내주신 피드백 감사합니다."

데모 전후 (demo_scheduled/demo_done):
→ 컨설팅 톤
→ "원장님 병원 상황을 분석해봤는데요..."

견적/결제 (proposal/negotiation):
→ 실무적 + 안심 주는 톤
→ "원장님, 문의하신 결제 관련 안내드립니다."

장기 육성 (nurturing):
→ 가벼운 정보 공유 톤
→ "원장님, 최근 RF 시장 트렌드 공유드립니다."
```

---

## 이 Phase 완료 후 상태

- 이메일 반응에 따른 자동 팔로업 작동
- AI 회신 분석 → 적절한 대응 자동 실행
- 관심도 자동 업데이트 (cold → warming → warm → hot)
- 카카오 알림톡 발송 작동
- 이메일 → 카카오톡 전환 플로우 작동
- hot 리드 발생 시 관리자 즉시 알림
- → 다음: `06-DEMO-CRM.md`
