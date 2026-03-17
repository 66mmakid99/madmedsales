/**
 * 범용 인트로 콜드메일 템플릿 (제품 무관)
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
  name: 'email-intro-generic',
  purpose: '범용 제품 인트로 콜드메일',
  model: 'claude-haiku-4-5-20251001' as const,

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
- 제목: 25자 이내, 스팸 키워드 없이
- 본문: 100~150자, 간결하게
- 어조: 실무적, 정중하게
- 혜택 1가지, 과장 없이
- 발신자명: '이재원 드림' (고정)
- 수신거부 링크, 서명 블록 포함 금지
- body_html: 심플 인라인 CSS HTML
- body_text: 평문

반드시 아래 JSON 형식으로만 응답하세요:
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
