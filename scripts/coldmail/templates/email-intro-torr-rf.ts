/**
 * TORR RF 장비 인트로 콜드메일 템플릿
 */

export interface TemplateContext {
  hospitalName: string;
  sido: string | null;
  sigungu: string | null;
  directorName: string | null;
  productName: string;
  productEmailGuide: Record<string, unknown>;
}

export const template = {
  name: 'email-intro-torr-rf',
  purpose: 'TORR RF 장비 첫 인트로 콜드메일',
  model: 'claude-sonnet-4-6' as const,  // 고가장비 → Sonnet

  buildPrompt(ctx: TemplateContext): string {
    const director = ctx.directorName ?? '원장';
    const region = [ctx.sido, ctx.sigungu].filter(Boolean).join(' ');
    return `
당신은 의료기기 영업 전문가입니다. 아래 정보를 바탕으로 병원 원장에게 보내는 콜드메일을 작성하세요.

수신 병원: ${ctx.hospitalName}${region ? ` (${region})` : ''}
호칭: ${director} 원장님
제품명: ${ctx.productName}
제품 영업 가이드: ${JSON.stringify(ctx.productEmailGuide, null, 2)}

작성 규칙:
- 제목: 25자 이내, 병원명 포함, 스팸 키워드(무료/특가/한정 등) 절대 금지
- 본문: 150~200자, 3문단 이내
  1문단: 자연스러운 첫인사 (영업 목적 감추지 않되 공격적이지 않게)
  2문단: 제품 핵심 가치 1가지만 (과장 없이, 구체적으로)
  3문단: 미팅/통화 제안 (가볍게)
- 발신자명: '이재원 드림' (고정)
- 수신거부 링크, 서명 블록은 포함하지 말 것 (시스템이 자동 추가)
- body_html: 인라인 CSS 포함 심플 HTML (태그: p, br, strong만 사용)
- body_text: HTML 없는 평문

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이:
{"subject":"...","body_html":"...","body_text":"..."}
    `.trim();
  },

  wrapHtml(body: string, unsubLink: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;color:#333;max-width:580px;margin:0 auto;padding:24px 20px;line-height:1.7">
${body}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 20px">
<p style="font-size:12px;color:#9ca3af;margin:0">
  본 메일은 병원 공개 정보 기반 영업 목적으로 발송되었습니다.<br>
  <a href="${unsubLink}" style="color:#9ca3af">수신거부</a>
</p>
</body>
</html>`;
  },
};
