# Phase 3: 이메일 자동화 (Week 7~8)

## 이 Phase의 목표

AI가 등급별 맞춤 이메일을 생성하고, 자동 발송하고, 오픈/클릭을 추적하는 시스템 완성. 소규모 테스트 발송까지.

## 선행 조건

- Phase 2 완료 (S/A 등급 리드 ~200건 생성, AI 분석 메모 포함)
- Resend 계정 + 도메인 인증 완료 (Phase 0에서)
- 이메일 도메인 웜업 시작 가능

## 완료 체크리스트

- [ ] 등급별 이메일 시퀀스 정의 (S/A/B 각 3~5단계)
- [ ] AI 이메일 생성 엔진 (Claude API)
- [ ] Resend 연동 (발송 + 추적 웹훅)
- [ ] 발송 큐 + 스케줄링
- [ ] 도메인 웜업 시작
- [ ] 수신거부 처리
- [ ] 테스트 발송 10건 + 추적 확인

---

## 1. Engine 코드 구조 (이 Phase)

```
apps/engine/src/
├── routes/
│   ├── emails.ts              # 이메일 생성/발송 API
│   ├── sequences.ts           # 시퀀스 관리 API
│   ├── webhooks.ts            # Resend 웹훅 수신
│   └── public.ts              # 수신거부 등 공개 API
├── services/
│   ├── ai/
│   │   ├── emailGenerator.ts  # AI 이메일 생성
│   │   ├── toneAdapter.ts     # 톤 조절
│   │   └── prompts/
│   │       ├── emailS.ts      # S등급 프롬프트
│   │       ├── emailA.ts      # A등급 프롬프트
│   │       ├── emailB.ts      # B등급 프롬프트
│   │       └── followup.ts    # 팔로업 프롬프트
│   └── email/
│       ├── sender.ts          # Resend 발송
│       ├── tracker.ts         # 이벤트 처리
│       └── queue.ts           # 발송 큐
└── types/
    └── email.ts
```

---

## 2. 이메일 시퀀스 설계

### S등급 시퀀스 (최우선 타깃)

| 단계 | 발송 시점 | 목적 | 톤 | 개인화 초점 |
|------|----------|------|-----|-----------|
| 1 | Day 0 | 첫 인사 + 핵심 가치 제안 | Professional | 병원 상황 맞춤 (AI 분석 기반) |
| 2 | Day 3 | 임상 데이터 + 유사 병원 사례 | Friendly | 같은 상권/규모 성공 사례 |
| 3 | Day 7 | 경쟁 현황 분석 리포트 | Consulting | 상권 내 RF 도입 현황 |
| 4 | Day 12 | ROI 시뮬레이션 | Practical | 예상 매출 증가분 |
| 5 | Day 18 | 한정 혜택 + 데모 제안 | Friendly | 기간 한정 조건 |

### A등급 시퀀스

| 단계 | 발송 시점 | 목적 | 톤 | 개인화 초점 |
|------|----------|------|-----|-----------|
| 1 | Day 0 | 첫 인사 + 시장 트렌드 | Professional | 일반적 가치 제안 |
| 2 | Day 5 | 케이스 스터디 | Friendly | 유사 병원 사례 |
| 3 | Day 10 | 시술 조합 제안 | Consulting | 장비 시너지 |
| 4 | Day 17 | 데모 제안 | Friendly | 부담 없는 데모 |

### B등급 시퀀스

| 단계 | 발송 시점 | 목적 | 톤 |
|------|----------|------|-----|
| 1 | Day 0 | 업계 트렌드 공유 | Professional |
| 2 | Day 7 | 기술 소개 | Professional |
| 3 | Day 14 | 자료 다운로드 유도 | Friendly |

### 시퀀스 규칙

```
공통 규칙:
- 회신이 오면 → 시퀀스 즉시 일시정지 → AI 회신 분석 → 수동/자동 대응
- 수신거부 → 시퀀스 즉시 종료 + unsubscribes 테이블 기록
- 바운스 → 시퀀스 종료 + 이메일 주소 무효화
- 시퀀스 완료 + 무반응 → stage를 'nurturing'으로 변경
```

---

## 3. AI 이메일 생성

### 프롬프트 구조

```typescript
// prompts/emailS.ts

export const S_GRADE_EMAIL_PROMPT = `
당신은 MADMEDSALES의 영업 전문가입니다.
한국의 피부과/성형외과 병원에 TORR RF(고주파 피부 리프팅 장비)를 제안하는 이메일을 작성합니다.

## TORR RF 핵심 정보
- 브랜드: BRITZMEDI
- 기능: 고주파(RF) 기반 피부 리프팅/타이트닝
- 가격대: 2,500~2,800만원 (이메일에서 직접 가격 언급 금지)
- 경쟁 제품: 써마지, 인모드 등
- 차별점: [TORR RF의 실제 차별점 - 추후 구체화]

## 이 병원에 대한 AI 분석
{{ai_analysis}}

## 이 병원 정보
- 병원명: {{hospital_name}}
- 위치: {{address}}
- 보유 장비: {{equipments}}
- 시술 메뉴: {{treatments}}
- 스코어링 등급: S (최우선 타깃)

## 이 이메일의 가이드
- 시퀀스 단계: {{step_number}} / {{total_steps}}
- 목적: {{step_purpose}}
- 톤: {{step_tone}}
- 핵심 메시지: {{step_key_message}}
- 개인화 초점: {{step_personalization_focus}}

{{#if previous_emails}}
## 이전 이메일 내용 (맥락 유지)
{{previous_emails}}
{{/if}}

## 작성 규칙
1. 제목: 병원명 포함, 30자 이내, 호기심 유발
2. 본문: 300자 이내 (모바일 최적화)
3. CTA: 1개만 (명확한 행동 유도)
4. 수신거부 링크: 반드시 하단에 포함
5. 가격 직접 언급 금지 (문의 유도)
6. 과장/허위 광고 금지 (의료기기법 준수)
7. 자연스러운 한국어 (번역체 금지)
8. 인사말: "원장님, 안녕하세요" 스타일 (이름 포함 가능)
9. 서명: MADMEDSALES 팀 (개인 이름 아님)

## 출력 형식
JSON으로 응답:
{
  "subject": "이메일 제목",
  "body_html": "HTML 형식 본문",
  "body_text": "텍스트 형식 본문",
  "personalization_notes": "적용한 개인화 요소 메모"
}
`;
```

### 이메일 생성 서비스

```typescript
// services/ai/emailGenerator.ts

interface GenerateEmailInput {
  lead: Lead;
  hospital: Hospital;
  equipments: Equipment[];
  treatments: Treatment[];
  scoringResult: ScoringResult;
  sequenceStep: SequenceStep;
  previousEmails: Email[];     // 이전에 보낸 이메일들
}

interface GenerateEmailOutput {
  subject: string;
  body_html: string;
  body_text: string;
  personalization_notes: string;
}

async function generateEmail(input: GenerateEmailInput): Promise<GenerateEmailOutput> {
  // 1. 등급에 따른 프롬프트 선택
  const promptTemplate = getPromptByGrade(input.lead.grade);
  
  // 2. 템플릿 변수 채우기
  const prompt = fillPromptTemplate(promptTemplate, input);
  
  // 3. AI 모델 선택
  //    S등급: Sonnet (높은 품질), A~C등급: Haiku (비용 효율)
  const model = input.lead.grade === 'S' 
    ? 'claude-sonnet-4-5-20250929' 
    : 'claude-haiku-4-5-20251001';
  
  // 4. Claude API 호출
  const response = await anthropic.messages.create({
    model,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // 5. JSON 파싱 + 검증
  const result = parseAndValidate(response.content[0].text);
  
  // 6. 수신거부 링크 삽입 (빠진 경우 강제 삽입)
  result.body_html = ensureUnsubscribeLink(result.body_html, input.lead.id);
  
  return result;
}
```

### 수신거부 링크

```html
<!-- 이메일 하단에 항상 포함 -->
<p style="font-size:11px; color:#999; margin-top:30px;">
  본 메일은 의료기기 도입을 고려하시는 병원에 발송되었습니다.<br>
  수신을 원치 않으시면 
  <a href="https://www.madmedsales.com/unsubscribe?lid={{lead_id}}&token={{token}}">
    여기를 클릭
  </a>해주세요.
</p>
```

---

## 4. Resend 연동

### 이메일 발송

```typescript
// services/email/sender.ts

import { Resend } from 'resend';

async function sendEmail(email: Email, env: Bindings): Promise<string> {
  const resend = new Resend(env.RESEND_API_KEY);
  
  const result = await resend.emails.send({
    from: 'MADMEDSALES <noreply@madmedsales.com>',
    replyTo: 'hello@madmedsales.com',
    to: email.to_email,
    subject: email.subject,
    html: email.body_html,
    text: email.body_text,
    headers: {
      'X-Lead-Id': email.lead_id,      // 추적용
      'X-Email-Id': email.id,           // 추적용
    },
    tags: [
      { name: 'grade', value: email.grade || 'unknown' },
      { name: 'sequence_step', value: String(email.step_number || 0) },
    ]
  });
  
  return result.data?.id || '';  // Resend 메시지 ID
}
```

### 웹훅 수신 (이메일 이벤트 추적)

```typescript
// routes/webhooks.ts

/**
 * POST /api/webhooks/email
 * 
 * Resend가 이메일 이벤트 발생 시 호출
 * 
 * 이벤트 종류:
 * - email.delivered: 도달 완료
 * - email.opened: 이메일 열람
 * - email.clicked: 링크 클릭
 * - email.bounced: 반송
 * - email.complained: 스팸 신고
 * 
 * 보안: Resend webhook signature 검증 필수
 */

app.post('/api/webhooks/email', async (c) => {
  // 1. Signature 검증
  const signature = c.req.header('svix-signature');
  if (!verifyResendSignature(signature, body, env.RESEND_WEBHOOK_SECRET)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }
  
  // 2. 이벤트 파싱
  const event = await c.req.json();
  
  // 3. email_events에 기록
  await supabase.from('email_events').insert({
    email_id: findEmailByExternalId(event.data.email_id),
    lead_id: extractLeadId(event),
    event_type: mapEventType(event.type),
    clicked_url: event.data.click?.url || null,
    clicked_page: classifyClickedPage(event.data.click?.url),
    ip_address: event.data.ip || null,
    user_agent: event.data.user_agent || null,
  });
  
  // 4. leads 테이블 업데이트
  switch (event.type) {
    case 'email.opened':
      await updateLead(leadId, {
        open_count: increment(1),
        last_email_opened_at: new Date(),
        interest_level: recalculateInterest(lead),
      });
      break;
    case 'email.clicked':
      await updateLead(leadId, {
        click_count: increment(1),
        last_email_clicked_at: new Date(),
      });
      // 클릭한 페이지 분류
      const page = classifyClickedPage(event.data.click?.url);
      if (page === 'demo') await incrementField(leadId, 'demo_page_visits');
      if (page === 'pricing') await incrementField(leadId, 'price_page_visits');
      break;
    case 'email.bounced':
      await updateLead(leadId, { stage: 'closed_lost', lost_reason: 'email_bounced' });
      break;
    case 'email.complained':
      await handleUnsubscribe(leadId, 'spam_complaint');
      break;
  }
  
  // 5. lead_activities에 타임라인 기록
  await logActivity(leadId, event.type, event);
  
  return c.json({ received: true });
});
```

### 클릭 URL 분류

```typescript
function classifyClickedPage(url: string | null): string | null {
  if (!url) return null;
  
  if (url.includes('/demo')) return 'demo';
  if (url.includes('/pricing') || url.includes('/price')) return 'pricing';
  if (url.includes('/product')) return 'product';
  if (url.includes('/resource') || url.includes('/download')) return 'resource';
  if (url.includes('/case') || url.includes('/success')) return 'case_study';
  if (url.includes('/compare')) return 'comparison';
  if (url.includes('/unsubscribe')) return 'unsubscribe';
  
  return 'other';
}
```

---

## 5. 발송 큐 + 스케줄링

### 큐 구조

```typescript
// services/email/queue.ts

/**
 * Cloudflare Queues 기반 이메일 발송 큐
 * 
 * 큐 메시지 형태:
 * {
 *   type: 'send_email',
 *   email_id: string,
 *   scheduled_at: string (ISO),
 *   retry_count: number
 * }
 * 
 * Consumer 로직:
 * 1. scheduled_at 확인 (미래면 재큐잉)
 * 2. 일일 발송량 체크 (system_settings.email_daily_limit)
 * 3. 발송 시간대 체크 (12~19시만 - 점심~저녁)
 * 4. 수신거부 체크 (unsubscribes 테이블)
 * 5. Resend API 호출
 * 6. 결과 업데이트
 * 
 * 실패 시: 3회까지 재시도 (exponential backoff)
 */

// 대안: Cloudflare Queues 대신 Cron Trigger + DB 기반 큐
// (Queues가 유료인 경우)

/**
 * DB 기반 큐 대안:
 * - emails 테이블의 status='queued'인 건을 조회
 * - Cron Trigger로 5분마다 실행
 * - sent_at이 null이고 scheduled_at이 현재 이전인 건 발송
 */
```

### Cron Trigger (발송 스케줄러)

```typescript
// wrangler.toml에 추가
// [triggers]
// crons = ["*/5 12-19 * * 1-5"]  # 평일 12~19시, 5분마다

export default {
  async scheduled(event: ScheduledEvent, env: Bindings) {
    // 1. 발송 대기 이메일 조회 (status=queued, scheduled_at <= now)
    // 2. 일일 한도 체크
    // 3. 순차 발송 (간격 1초)
    // 4. 결과 업데이트
  }
};
```

---

## 6. 도메인 웜업 스케줄

```
새 도메인에서 갑자기 대량 발송하면 스팸 처리됨.
단계적으로 발송량을 늘려야 함.

Week 1 (이 Phase): 일 10통 (테스트)
Week 2: 일 20통
Week 3: 일 30통
Week 4+: 일 50통

웜업 기간 중 주의:
- 가능하면 오픈율이 높을 것 같은 S등급부터 발송
- 오픈/클릭이 많을수록 도메인 평판 상승
- 바운스/스팸신고 최소화 (이메일 주소 검증 필요)
```

---

## 7. 수신거부 처리

### 공개 API

```typescript
// routes/public.ts

/**
 * GET /api/public/unsubscribe?lid={lead_id}&token={token}
 * 
 * 1. 토큰 검증 (lead_id + secret으로 생성된 HMAC)
 * 2. unsubscribes 테이블에 INSERT
 * 3. leads 테이블: stage = 'closed_lost', lost_reason = 'unsubscribed'
 * 4. 진행 중인 시퀀스 즉시 중단
 * 5. 감사 페이지로 리다이렉트
 */
```

### 토큰 생성

```typescript
function generateUnsubscribeToken(leadId: string, secret: string): string {
  // HMAC-SHA256으로 토큰 생성
  // URL에 포함되므로 base64url 인코딩
  return hmacSHA256(leadId, secret).toString('base64url');
}
```

---

## 8. 시퀀스 실행 엔진

```typescript
/**
 * Cron: 매일 12:00에 실행
 * 
 * 처리:
 * 1. 활성 시퀀스에 속한 리드 조회 (stage: contacted, 시퀀스 미완료)
 * 2. 각 리드의 현재 시퀀스 단계 확인
 * 3. 다음 단계의 delay_days 확인
 * 4. last_email_sent_at + delay_days <= 오늘이면:
 *    a. 건너뛰기 조건 체크 (skip_if)
 *    b. AI 이메일 생성
 *    c. 발송 큐에 추가
 *    d. current_sequence_step 업데이트
 * 5. 마지막 단계 완료 + 무반응이면:
 *    - stage → 'nurturing'
 *    - 월간 뉴스레터 리스트에 추가
 */
```

---

## 9. 이메일 API

### routes/emails.ts

```typescript
/**
 * POST /api/emails/generate
 * - body: { lead_id, sequence_step? }
 * - AI가 이메일 생성 → emails 테이블에 저장 (status: draft)
 * - 응답: 생성된 이메일 내용 (미리보기용)
 * 
 * POST /api/emails/send
 * - body: { email_id }
 * - draft 상태 이메일을 발송 큐에 추가
 * 
 * POST /api/emails/send-batch
 * - body: { lead_ids[], auto_generate: true }
 * - 여러 리드에 시퀀스 이메일 일괄 생성 + 큐 추가
 * 
 * GET /api/emails
 * - 이메일 목록 (필터: status, lead_id, date range)
 * 
 * GET /api/emails/:id
 * - 이메일 상세 (내용 + 이벤트 이력)
 * 
 * GET /api/emails/stats
 * - 이메일 통계 (발송수, 도달률, 오픈율, 클릭률)
 */
```

### routes/sequences.ts

```typescript
/**
 * GET /api/sequences
 * - 시퀀스 목록
 * 
 * GET /api/sequences/:id
 * - 시퀀스 상세 (단계 포함)
 * 
 * POST /api/sequences
 * - 시퀀스 생성
 * 
 * PUT /api/sequences/:id
 * - 시퀀스 수정
 * 
 * POST /api/sequences/:id/steps
 * - 시퀀스에 단계 추가
 * 
 * PUT /api/sequences/:id/steps/:stepId
 * - 단계 수정
 */
```

---

## 10. 이메일 발송 시간 전략

```
최적 발송 시간 (한국 피부과/성형외과 기준):

- 화~목 12:00~13:00 (점심시간) ← 최우선
- 월~금 17:00~18:00 (진료 마감 전후) ← 차선
- 토요일 오전 (반일 진료 후) ← 가능

절대 금지:
- 야간 (21:00~08:00)
- 일요일
- 공휴일

이유: 원장들은 점심시간이나 진료 후에 이메일 확인할 가능성 높음
```

---

## 11. 테스트 발송 계획

```
1단계: 내부 테스트 (Day 1~2)
- 자기 이메일로 발송 테스트 (5건)
- 오픈/클릭 추적 작동 확인
- 수신거부 작동 확인
- 이메일 렌더링 확인 (Gmail, Naver Mail)

2단계: 실전 테스트 (Day 3~5)
- S등급 상위 10건에 실제 발송
- 오픈율 모니터링
- AI 생성 이메일 품질 검수 (사람이 직접 읽어보기)
- 프롬프트 튜닝 (필요시)

3단계: 웜업 본격 시작
- 일 10통씩 S등급부터 순차 발송
- 주간 리포트: 발송수, 도달률, 오픈율
```

---

## 이 Phase 완료 후 상태

- 이메일 시퀀스 3개 (S/A/B) 설정 완료
- AI가 병원별 맞춤 이메일 자동 생성
- Resend 통한 발송 + 오픈/클릭 추적 작동
- 수신거부 처리 완료
- 테스트 10건 발송 + 추적 확인
- 도메인 웜업 진행 중
- → 다음: `05-RESPONSE.md`
