/**
 * v5.5 연락처 URL 패턴 매칭 모듈
 * Gemini 분류와 독립으로, 크롤링 전체 텍스트에서 SNS/연락처 URL을 정규식으로 직접 추출
 */

export interface ExtractedContact {
  type: string;
  value: string;
  source: string;  // 발견된 위치 설명
}

interface PatternDef {
  type: string;
  patterns: RegExp[];
  cleanUp?: (url: string) => string;
}

const CONTACT_PATTERNS: PatternDef[] = [
  {
    type: 'kakao_channel',
    patterns: [
      /https?:\/\/pf\.kakao\.com\/[^\s)"'<>]+/gi,
      /https?:\/\/plus\.kakao\.com\/[^\s)"'<>]+/gi,
      /https?:\/\/open\.kakao\.com\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'blog',
    patterns: [
      /https?:\/\/(?:m\.)?blog\.naver\.com\/[^\s)"'<>]+/gi,
      /https?:\/\/blog\.daum\.net\/[^\s)"'<>]+/gi,
      /https?:\/\/[a-z0-9-]+\.tistory\.com(?:\/[^\s)"'<>]*)?/gi,
    ],
  },
  {
    type: 'instagram',
    patterns: [
      /https?:\/\/(?:www\.)?instagram\.com\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'facebook',
    patterns: [
      /https?:\/\/(?:www\.|m\.)?facebook\.com\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'youtube',
    patterns: [
      /https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|@)[^\s)"'<>]+/gi,
      /https?:\/\/youtu\.be\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'naver_booking',
    patterns: [
      /https?:\/\/(?:m\.)?booking\.naver\.com\/[^\s)"'<>]+/gi,
      /https?:\/\/m\.place\.naver\.com\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'naver_place',
    patterns: [
      /https?:\/\/(?:m\.)?map\.naver\.com\/[^\s)"'<>]+/gi,
      /https?:\/\/naver\.me\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'naver_talktalk',
    patterns: [
      /https?:\/\/talk\.naver\.com\/[^\s)"'<>]+/gi,
    ],
  },
  {
    type: 'twitter',
    patterns: [
      /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s)"'<>]+/gi,
    ],
  },
];

const PHONE_PATTERNS = [
  /(?:tel:)?0\d{1,2}[-.]\d{3,4}[-.]\d{4}/g,
  /(?:tel:)?15\d{2}[-.]\d{4}/g,
  /(?:tel:)?16\d{2}[-.]\d{4}/g,
  /(?:tel:)?18\d{2}[-.]\d{4}/g,
];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * 크롤링 텍스트에서 연락처 URL/정보를 직접 추출
 */
export function extractContactsFromText(allText: string): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];
  const seen = new Set<string>();

  // SNS/채널 URL 추출
  for (const def of CONTACT_PATTERNS) {
    for (const pattern of def.patterns) {
      pattern.lastIndex = 0;
      const matches = allText.match(pattern);
      if (matches) {
        for (const rawUrl of matches) {
          // 후행 슬래시/괄호 정리
          let url = rawUrl.replace(/[)"'<>,]+$/, '').replace(/\/$/, '');
          if (def.cleanUp) url = def.cleanUp(url);
          const key = `${def.type}:${url.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            contacts.push({ type: def.type, value: url, source: 'text_pattern' });
          }
        }
      }
    }
  }

  // 전화번호 추출
  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = allText.match(pattern);
    if (matches) {
      for (const raw of matches) {
        const num = raw.replace(/^tel:/, '').trim();
        const key = `phone:${num.replace(/[-.]/g, '')}`;
        if (!seen.has(key)) {
          seen.add(key);
          contacts.push({ type: 'phone', value: num, source: 'text_pattern' });
        }
      }
    }
  }

  // 이메일 추출
  const emailMatches = allText.match(EMAIL_PATTERN);
  if (emailMatches) {
    for (const email of emailMatches) {
      // 일반적인 이미지 확장자나 도메인 필터
      if (/\.(png|jpg|gif|svg|webp|ico|css|js)$/i.test(email)) continue;
      if (/example\.com|test\.com|domain\.com/i.test(email)) continue;
      const key = `email:${email.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        contacts.push({ type: 'email', value: email, source: 'text_pattern' });
      }
    }
  }

  return contacts;
}

/**
 * 코드 추출 결과를 Gemini 분석 결과와 병합
 * Gemini가 못 찾은 것을 보완
 */
export function mergeContacts(
  geminiContact: Record<string, unknown> | undefined,
  extracted: ExtractedContact[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(geminiContact || {}) };

  for (const c of extracted) {
    switch (c.type) {
      case 'kakao_channel':
        if (!result['kakao_channel'] || typeof result['kakao_channel'] !== 'string' || !result['kakao_channel'].startsWith('http')) {
          result['kakao_channel'] = c.value;
        }
        break;
      case 'blog':
        if (!result['blog']) result['blog'] = c.value;
        break;
      case 'instagram':
        if (!result['instagram']) result['instagram'] = c.value;
        break;
      case 'facebook':
        if (!result['facebook']) result['facebook'] = c.value;
        break;
      case 'youtube':
        if (!result['youtube'] || typeof result['youtube'] !== 'string' || !result['youtube'].startsWith('http')) {
          result['youtube'] = c.value;
        }
        break;
      case 'naver_booking':
        if (!result['naver_booking']) result['naver_booking'] = c.value;
        break;
      case 'naver_place':
        if (!result['naver_place']) result['naver_place'] = c.value;
        break;
      case 'naver_talktalk':
        if (!result['naver_talktalk']) result['naver_talktalk'] = c.value;
        break;
      case 'twitter':
        if (!result['twitter']) result['twitter'] = c.value;
        break;
      // phone, email은 기존 배열에 추가하는 방식으로 처리
    }
  }

  return result;
}
