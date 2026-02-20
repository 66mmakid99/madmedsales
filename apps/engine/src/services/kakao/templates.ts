// v1.0 - 2026-02-20
// Kakao Alimtalk templates

export interface KakaoTemplate {
  code: string;
  name: string;
  messageType: 'AT';
  content: string;
  buttons: KakaoButton[];
}

export interface KakaoButton {
  type: 'WL' | 'AL' | 'DS' | 'BK' | 'MD';
  name: string;
  linkMobile?: string;
  linkPc?: string;
}

export const KAKAO_TEMPLATES: Record<string, KakaoTemplate> = {
  DEMO_CONFIRM: {
    code: 'DEMO_CONFIRM',
    name: '데모 일정 확정',
    messageType: 'AT',
    content: `안녕하세요, #{hospitalName} #{doctorName} 원장님.

TORR RF 데모 일정이 확정되었습니다.

- 일시: #{demoDate}
- 장소: #{demoLocation}
- 담당자: #{repName}

변경이 필요하시면 아래 버튼을 통해 연락해주세요.`,
    buttons: [
      {
        type: 'WL',
        name: '일정 확인',
        linkMobile: '#{webUrl}/demo/#{demoId}',
        linkPc: '#{webUrl}/demo/#{demoId}',
      },
    ],
  },

  DEMO_REMINDER: {
    code: 'DEMO_REMINDER',
    name: '데모 일정 리마인더',
    messageType: 'AT',
    content: `#{doctorName} 원장님, 안녕하세요.

내일 예정된 TORR RF 데모 일정을 알려드립니다.

- 일시: #{demoDate}
- 장소: #{demoLocation}

원장님을 뵐 수 있어서 기대됩니다.`,
    buttons: [
      {
        type: 'WL',
        name: '일정 확인',
        linkMobile: '#{webUrl}/demo/#{demoId}',
        linkPc: '#{webUrl}/demo/#{demoId}',
      },
    ],
  },

  MATERIAL_SEND: {
    code: 'MATERIAL_SEND',
    name: '자료 발송 알림',
    messageType: 'AT',
    content: `#{doctorName} 원장님, 안녕하세요.

요청하신 TORR RF 관련 자료를 이메일로 발송해 드렸습니다.

- 발송 이메일: #{email}
- 자료: #{materialName}

궁금하신 점이 있으시면 편하게 문의해 주세요.`,
    buttons: [
      {
        type: 'WL',
        name: '자료 확인',
        linkMobile: '#{webUrl}/materials',
        linkPc: '#{webUrl}/materials',
      },
    ],
  },

  WELCOME: {
    code: 'WELCOME',
    name: '채널 추가 환영',
    messageType: 'AT',
    content: `#{doctorName} 원장님, 안녕하세요!

MADMEDSALES 채널을 추가해 주셔서 감사합니다.

최신 RF 리프팅 트렌드와 유용한 정보를 카카오톡으로 편하게 받아보세요.

문의사항은 언제든 이 채널로 말씀해 주세요.`,
    buttons: [
      {
        type: 'WL',
        name: '제품 알아보기',
        linkMobile: '#{webUrl}/product/torr-rf',
        linkPc: '#{webUrl}/product/torr-rf',
      },
    ],
  },
};

export function getTemplate(code: string): KakaoTemplate | null {
  return KAKAO_TEMPLATES[code] ?? null;
}

export function fillTemplateParams(
  content: string,
  params: Record<string, string>
): string {
  let result = content;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`#\\{${key}\\}`, 'g'), value);
  }
  return result;
}
