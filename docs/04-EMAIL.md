# Phase 3: 제품별 이메일 자동화 (Week 7~8)

## 이 Phase의 목표

제품별 맞춤 이메일 시퀀스를 AI가 생성·발송·추적하는 시스템 완성. 제품 유형(고가 장비 vs 소모품)에 따라 시퀀스 길이와 톤이 달라짐.

## 핵심 개념: 제품별 시퀀스

```
같은 병원이라도 제품이 다르면 이메일이 다름:

TORR RF (고가 장비 2,500만원):
→ 5단계 시퀀스, 신중한 톤, 데모 유도, 가격 비공개

2mm 바늘 (소모품):
→ 2단계 시퀀스, 실무적 톤, 바로 견적, 가격 공개

관리장비 (중가 장비):
→ 3단계 시퀀스, 제품별 맞춤 톤
```

## 선행 조건

- Phase 2 완료 (제품별 S/A 등급 리드 생성, AI 분석 메모 포함)
- Resend 계정 + 도메인 인증 완료
- 이메일 도메인 웜업 시작 가능

## 완료 체크리스트

- [ ] 제품 유형별 이메일 시퀀스 정의
- [ ] AI 이메일 생성 엔진 (Claude API + 제품 정보 주입)
- [ ] Resend 연동 (발송 + 추적 웹훅)
- [ ] 발송 큐 + 스케줄링
- [ ] 수신거부 처리
- [ ] 테스트 발송 + 추적 확인

---

## 1. Engine 코드 구조

```
apps/engine/src/
├── routes/
│   ├── emails.ts              # 이메일 생성/발송 API
│   ├── sequences.ts           # 시퀀스 관리 API
│   ├── webhooks.ts            # Resend 웹훅 수신
│   └── public.ts              # 수신거부 등 공개 API
├── services/
│   ├── ai/
│   │   ├── email-generator.ts # AI 이메일 생성 (제품 정보 주입)
│   │   └── prompts/
│   │       ├── email-equipment.ts   # 고가 장비용 프롬프트
│   │       ├── email-consumable.ts  # 소모품용 프롬프트
│   │       └── email-followup.ts    # 팔로업 프롬프트
│   └── email/
│       ├── sender.ts          # Resend 발송
│       ├── tracker.ts         # 이벤트 처리
│       └── queue.ts           # 발송 큐
```

---

## 2. 제품 유형별 시퀀스 설계

### 고가 장비용 시퀀스 (TORR RF 등, 1,000만원+)

| 단계 | 발송 시점 | 목적 | 톤 | 개인화 초점 |
|------|----------|------|-----|-----------|
| 1 | Day 0 | 핵심 가치 제안 | Professional | 병원 상황 맞춤 (AI 분석 기반) |
| 2 | Day 3 | 임상 데이터 + 유사 병원 사례 | Friendly | 같은 상권/규모 성공 사례 |
| 3 | Day 7 | 경쟁 현황 + 시너지 장비 조합 | Consulting | 상권 분석, 장비 시너지 |
| 4 | Day 12 | ROI 시뮬레이션 | Practical | 예상 매출 증가분 |
| 5 | Day 18 | 한정 혜택 + 데모 제안 | Friendly | 기간 한정 조건 |

### 소모품용 시퀀스 (2mm 바늘 등, 수십만원 이하)

| 단계 | 발송 시점 | 목적 | 톤 |
|------|----------|------|-----|
| 1 | Day 0 | 소모품 안내 + 가격 | Practical |
| 2 | Day 5 | 대량 주문 할인 + 주문 유도 | Friendly |

### 중가 장비용 시퀀스 (유통/제휴 장비, 500만~2,000만원)

| 단계 | 발송 시점 | 목적 | 톤 |
|------|----------|------|-----|
| 1 | Day 0 | 제품 소개 + 가치 제안 | Professional |
| 2 | Day 5 | 사례 + 비교 자료 | Consulting |
| 3 | Day 12 | 데모 제안 | Friendly |

### 시퀀스 공통 규칙

```
- 회신이 오면 → 시퀀스 즉시 일시정지 → AI 회신 분석 → 대응
- 수신거부 → 시퀀스 즉시 종료 + unsubscribes 기록
  ※ 수신거부는 병원 단위가 아닌 이메일 단위. 같은 병원이 다른 제품 메일은 받을 수 있음
  ※ 단, 같은 이메일 주소로 수신거부하면 모든 제품 메일 중단
- 바운스 → 시퀀스 종료 + 이메일 주소 무효화
- 시퀀스 완료 + 무반응 → stage를 'nurturing'으로 변경
```

---

## 3. AI 이메일 생성 (제품 정보 동적 주입)

### 프롬프트 구조

```typescript
/**
 * 핵심 변경: 프롬프트에 "제품 정보"를 동적으로 주입
 * 
 * 기존: TORR RF 정보가 프롬프트에 하드코딩
 * 변경: products 테이블의 email_guide를 프롬프트에 주입
 */

const EMAIL_GENERATION_PROMPT = `
당신은 MADMEDSALES의 영업 전문가입니다.
한국의 피부과/성형외과 병원에 아래 제품을 제안하는 이메일을 작성합니다.

## 제품 정보
- 제품명: {{product_name}}
- 제조사: {{product_manufacturer}}
- 카테고리: {{product_category}}
- {{product_email_guide}}

## 이 병원에 대한 AI 분석
{{ai_match_analysis}}

## 이 병원 정보
- 병원명: {{hospital_name}}
- 위치: {{address}}
- 보유 장비: {{equipments}}
- 시술 메뉴: {{treatments}}
- 병원 프로파일: {{profile_grade}} ({{profile_summary}})
- 제품 매칭: {{match_grade}}

## 이 이메일의 가이드
- 시퀀스 단계: {{step_number}} / {{total_steps}}
- 목적: {{step_purpose}}
- 톤: {{step_tone}}
- 개인화 초점: {{step_personalization_focus}}

{{#if previous_emails}}
## 이전 이메일 (맥락 유지)
{{previous_emails}}
{{/if}}

## 작성 규칙
1. 제목: 병원명 포함, 30자 이내
2. 본문: 300자 이내 (모바일 최적화)
3. CTA: 1개만
4. 수신거부 링크: 하단 필수
5. 자연스러운 한국어
6. 의료기기법 준수 (과장/허위 금지)
7. 인사말: "원장님, 안녕하세요" 스타일

## 출력 (JSON)
{
  "subject": "이메일 제목",
  "body_html": "HTML 본문",
  "body_text": "텍스트 본문",
  "personalization_notes": "적용한 개인화 요소"
}
`;
```

### AI 모델 선택

```typescript
// 제품 가격대 + 리드 등급에 따라 모델 선택
function selectModel(product: Product, grade: string): string {
  // 고가 장비의 S등급 → Sonnet (높은 품질)
  if (product.category === 'equipment' && grade === 'S') {
    return 'claude-sonnet-4-5-20250929';
  }
  // 나머지 → Haiku (비용 효율)
  return 'claude-haiku-4-5-20251001';
}
```

---

## 4. Resend 연동 + 추적

### 이메일 발송

```typescript
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
      'X-Lead-Id': email.lead_id,
      'X-Email-Id': email.id,
    },
    tags: [
      { name: 'product', value: email.product_id },
      { name: 'grade', value: email.grade || 'unknown' },
      { name: 'step', value: String(email.step_number || 0) },
    ]
  });
  
  return result.data?.id || '';
}
```

### 웹훅 수신

```typescript
/**
 * POST /api/webhooks/email
 * 
 * 이벤트: delivered, opened, clicked, bounced, complained
 * 
 * 처리:
 * 1. Signature 검증
 * 2. email_events에 기록
 * 3. leads 테이블 업데이트 (open_count, click_count 등)
 * 4. lead_activities 타임라인 기록
 * 5. 트리거 조건 체크 (Phase 4에서 구현)
 */
```

---

## 5. 발송 큐 + 스케줄링

```typescript
/**
 * DB 기반 큐 (Cloudflare Queues 대안)
 * - emails 테이블의 status='queued'인 건 조회
 * - Cron Trigger: 평일 12~19시, 5분마다
 * 
 * 발송 시간 전략 (한국 피부과/성형외과):
 * - 화~목 12:00~13:00 (점심시간) ← 최우선
 * - 월~금 17:00~18:00 (진료 마감) ← 차선
 * - 야간/주말/공휴일 발송 금지
 */
```

---

## 6. 도메인 웜업 + 멀티 제품 발송 전략

```
웜업 기간:
Week 1: 일 10통 (테스트)
Week 2: 일 20통
Week 3: 일 30통
Week 4+: 일 50통

멀티 제품 발송 규칙:
- 같은 병원에 다른 제품 메일은 최소 7일 간격
- 같은 날 같은 병원에 2개 이상 제품 메일 발송 금지
- 제품별 발송 우선순위: 고가 장비 > 중가 장비 > 소모품
- S등급 리드부터 발송 (도메인 평판 상승 효과)
```

---

## 7. 수신거부 처리

```typescript
/**
 * GET /api/public/unsubscribe?lid={lead_id}&token={token}
 * 
 * 1. 토큰 검증
 * 2. unsubscribes 테이블에 이메일 등록
 * 3. 해당 이메일의 모든 리드: 시퀀스 즉시 중단
 *    (같은 병원 이메일 = 모든 제품 메일 중단)
 * 4. 감사 페이지로 리다이렉트
 */
```

---

## 8. 이메일 API

```typescript
/**
 * POST /api/emails/generate
 * - body: { lead_id } → 해당 리드의 제품 정보를 자동 로드하여 이메일 생성
 * 
 * POST /api/emails/send
 * - body: { email_id } → 발송 큐에 추가
 * 
 * POST /api/emails/send-batch
 * - body: { product_id, grade?: 'S'|'A', limit?: 10 }
 * - 특정 제품의 리드에 일괄 이메일 생성 + 큐 추가
 * 
 * GET /api/emails
 * - 필터: status, product_id, lead_id, date range
 * 
 * GET /api/emails/stats
 * - 제품별 이메일 통계 (발송수, 도달률, 오픈율, 클릭률)
 * 
 * GET /api/sequences
 * POST /api/sequences
 * PUT /api/sequences/:id
 */
```

---

## 이 Phase 완료 후 상태

- 제품 유형별 이메일 시퀀스 설정 완료 (고가장비/중가장비/소모품)
- AI가 제품 정보를 동적으로 주입하여 병원별 맞춤 이메일 자동 생성
- Resend 통한 발송 + 오픈/클릭 추적 작동
- 멀티 제품 발송 중복 방지 로직 작동
- 수신거부 처리 완료
- 도메인 웜업 진행 중
- → 다음: `05-RESPONSE.md`
