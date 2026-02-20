// v1.0 - 2026-02-20
// Tone adaptation service for email content

export const TONES = [
  'professional',
  'friendly',
  'consulting',
  'casual',
  'practical',
] as const;
export type Tone = (typeof TONES)[number];

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  professional:
    '격식 있고 신뢰감을 주는 톤. 존칭 사용, 전문 용어 적절히 활용.',
  friendly:
    '친근하고 따뜻한 톤. 딱딱하지 않되 예의 바르게. 원장님과의 관계 형성 중시.',
  consulting:
    '전문 컨설턴트 톤. 데이터와 인사이트 기반, 권위 있되 겸손하게.',
  casual:
    '가벼운 톤. 정보 공유하는 느낌, 부담 없는 대화체.',
  practical:
    '실용적인 톤. 숫자와 구체적 혜택 중심, 간결하고 명확하게.',
};

interface ToneEnv {
  ANTHROPIC_API_KEY: string;
}

export async function adaptTone(
  env: ToneEnv,
  content: string,
  targetTone: Tone
): Promise<string> {
  const instruction = TONE_INSTRUCTIONS[targetTone];

  const prompt = `아래 이메일 본문의 톤을 변경해주세요. 내용은 유지하되 말투와 분위기만 바꿔주세요.

## 목표 톤
${instruction}

## 원본 내용
${content}

## 규칙
- 내용(정보, CTA, 링크)은 절대 변경하지 마세요
- HTML 구조를 유지하세요
- 톤/말투만 변경하세요
- 한국어 자연스럽게

변환된 내용만 출력하세요 (설명 없이).`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data: unknown = await response.json();
    return extractText(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Tone adaptation failed: ${message}`);
  }
}

function extractText(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid API response');
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['content'])) {
    throw new Error('Missing content in response');
  }
  for (const block of obj['content'] as unknown[]) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>)['type'] === 'text'
    ) {
      return (block as Record<string, unknown>)['text'] as string;
    }
  }
  throw new Error('No text in response');
}
