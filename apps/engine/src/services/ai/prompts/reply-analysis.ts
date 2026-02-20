// v1.0 - 2026-02-20
// Reply analysis prompt: 원장님 회신 분석

export interface ReplyAnalysisInput {
  ourEmailSubject: string;
  ourEmailSummary: string;
  replyContent: string;
}

export interface ReplyAnalysisOutput {
  sentiment: 'positive' | 'neutral' | 'negative' | 'question';
  purchase_intent: 'high' | 'medium' | 'low' | 'none';
  reply_type: 'inquiry' | 'interest' | 'objection' | 'request' | 'rejection' | 'other';
  key_concern: string | null;
  summary: string;
  recommended_response: string;
  should_connect_kakao: boolean;
  should_notify_admin: boolean;
  urgency: 'immediate' | 'today' | 'normal' | 'low';
}

export function buildReplyAnalysisPrompt(input: ReplyAnalysisInput): string {
  return `당신은 한국 의료기기 영업 전문 분석가입니다.
병원 원장님의 회신 이메일을 분석하여 영업 전략을 제시하세요.

## 우리가 보낸 이메일
- 제목: ${input.ourEmailSubject}
- 요약: ${input.ourEmailSummary}

## 원장님 회신 내용
${input.replyContent}

## 분석 기준
1. sentiment: 전반적인 감정 (positive/neutral/negative/question)
2. purchase_intent: 구매 의향 수준 (high/medium/low/none)
3. reply_type: 회신 유형
   - inquiry: 제품/서비스 문의
   - interest: 관심 표현
   - objection: 이의 제기 (가격, 필요성 등)
   - request: 자료/데모 요청
   - rejection: 거절
   - other: 기타
4. key_concern: 핵심 관심사 또는 우려 사항
5. summary: 회신 내용 한 줄 요약
6. recommended_response: 권장 대응 방안
7. should_connect_kakao: 카카오톡 연결 추천 여부 (긴급 문의, 데모 요청 등)
8. should_notify_admin: 관리자 알림 필요 여부 (거절, 높은 구매의향 등)
9. urgency: 대응 긴급도
   - immediate: 즉시 (데모 요청, 구매 의사 표시)
   - today: 당일 내 (구체적 문의)
   - normal: 일반 (관심 표현)
   - low: 낮음 (일반 회신)

## 응답 형식 (JSON만 출력)
{
  "sentiment": "positive|neutral|negative|question",
  "purchase_intent": "high|medium|low|none",
  "reply_type": "inquiry|interest|objection|request|rejection|other",
  "key_concern": "핵심 관심사 또는 null",
  "summary": "한 줄 요약",
  "recommended_response": "권장 대응 방안",
  "should_connect_kakao": true|false,
  "should_notify_admin": true|false,
  "urgency": "immediate|today|normal|low"
}`;
}
