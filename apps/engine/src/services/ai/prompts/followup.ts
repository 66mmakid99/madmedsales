// v1.0 - 2026-02-20
// Follow-up email prompt: 다양한 트리거 시나리오에 대한 후속 이메일 생성

export type FollowupTrigger =
  | 'email_opened'
  | 'link_clicked'
  | 'demo_page_visited'
  | 'price_page_visited'
  | 'reply_received'
  | 'no_response'
  | 're_approach';

export interface FollowupPromptInput {
  hospitalName: string;
  doctorName: string | null;
  trigger: FollowupTrigger;
  triggerDetail: string | null;
  previousEmails: { subject: string; sentAt: string; opened: boolean }[];
  interestLevel: string;
  replyContent: string | null;
  unsubscribeUrl: string;
}

export function buildFollowupPrompt(input: FollowupPromptInput): string {
  const triggerDescriptions: Record<FollowupTrigger, string> = {
    email_opened: '이전 이메일을 열어보셨습니다',
    link_clicked: `이메일 내 링크를 클릭하셨습니다${input.triggerDetail ? ` (${input.triggerDetail})` : ''}`,
    demo_page_visited: '데모 신청 페이지를 방문하셨습니다',
    price_page_visited: '가격 페이지를 방문하셨습니다',
    reply_received: '회신을 보내셨습니다',
    no_response: '이전 이메일에 반응이 없었습니다',
    re_approach: '일정 기간 후 재접근합니다',
  };

  const previousContext = input.previousEmails
    .map((e, i) => `  ${i + 1}회차: "${e.subject}" (${e.sentAt}) - ${e.opened ? '열람' : '미열람'}`)
    .join('\n');

  return `당신은 한국 피부과/성형외과 의료기기 영업 전문가입니다.
아래 상황에 맞는 후속(follow-up) 이메일을 작성하세요.

## 상황
- 병원명: ${input.hospitalName}
- 원장님: ${input.doctorName ?? '미확인'}
- 트리거: ${triggerDescriptions[input.trigger]}
- 현재 관심도: ${input.interestLevel}
${input.replyContent ? `\n## 원장님 회신 내용\n${input.replyContent}` : ''}

## 이전 발송 이력
${previousContext || '  없음'}

## 제품: TORR RF (BRITZMEDI)
- RF 리프팅 장비, 가격 절대 언급 금지

## 작성 규칙
1. 제목: 30자 이내, 병원명 포함
2. 본문: 300자 이내
3. 트리거에 맞는 자연스러운 후속 메시지
4. CTA 1개
5. 수신거부 링크 필수: ${input.unsubscribeUrl}
6. 가격 언급 금지
7. 자연스러운 한국어, 이전 맥락 자연스럽게 이어가기
8. 회신에 대한 답변인 경우: 구체적으로 응답하되 과도하게 밀지 않기

## 트리거별 가이드
- email_opened: 관심 표현에 감사 + 추가 정보 제안
- link_clicked: 클릭한 내용 관련 심화 정보 제공
- demo_page_visited: 데모 일정 확정 유도 (부담 없이)
- price_page_visited: 투자 대비 효과(ROI) 중심 접근
- reply_received: 회신 내용에 맞춤 응답
- no_response: 다른 각도로 가치 제안
- re_approach: 새로운 정보/업데이트로 재접근

## 응답 형식 (JSON만 출력)
{
  "subject": "이메일 제목",
  "body_html": "<html>본문</html>",
  "body_text": "텍스트 본문",
  "personalization_notes": "후속 전략 설명"
}`;
}
