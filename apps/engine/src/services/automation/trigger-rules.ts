// v2.0 - 2026-03-16
// Trigger rule definitions: product-type differentiated + common rules
// Design: docs/05-RESPONSE.md

import type { TriggerAction } from './action-executor';

export interface TriggerCondition {
  field: string;
  operator: 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'not_null' | 'is_true';
  value: unknown;
}

export interface TriggerRule {
  id: string;
  name: string;
  conditions: TriggerCondition[];
  actions: TriggerAction[];
  cooldownMinutes: number;
  enabled: boolean;
}

// 제품 카테고리별 트리거 임계값 (docs/05-RESPONSE.md)
export interface ProductTriggerThresholds {
  openCountForFollowup: number;   // 열람 후 후속 이메일 발송 기준
  pricePageVisitsForWarm: number; // 가격 페이지 warm 전환 기준
  demoPush: boolean;              // 데모 유도 여부
  instantQuoteOnClick: boolean;   // 클릭 즉시 견적 여부
}

export function getProductTriggerThresholds(category: string): ProductTriggerThresholds {
  switch (category) {
    case 'equipment': // 고가 장비: 트리거 반응 느리게, 데모 유도 적극
      return { openCountForFollowup: 3, pricePageVisitsForWarm: 2, demoPush: true, instantQuoteOnClick: false };
    case 'consumable': // 소모품: 1회 클릭 즉시 견적, 데모 불필요
      return { openCountForFollowup: 1, pricePageVisitsForWarm: 1, demoPush: false, instantQuoteOnClick: true };
    default: // 중가 장비 및 기타
      return { openCountForFollowup: 2, pricePageVisitsForWarm: 1, demoPush: true, instantQuoteOnClick: false };
  }
}

// 공통 트리거 규칙 (제품 카테고리 무관)
export const DEFAULT_TRIGGER_RULES: TriggerRule[] = [
  {
    id: 'link_clicked_upgrade',
    name: '링크 클릭 시 관심도 상향',
    conditions: [{ field: 'click_count', operator: 'gte', value: 1 }],
    actions: [
      { type: 'update_interest', params: { level: 'warm' } },
      { type: 'send_email', params: { trigger: 'link_clicked' } },
    ],
    cooldownMinutes: 1440,
    enabled: true,
  },
  {
    id: 'demo_page_hot',
    name: '데모 페이지 2회 이상 방문 시 핫 리드',
    conditions: [{ field: 'demo_page_visits', operator: 'gte', value: 2 }],
    actions: [
      { type: 'update_interest', params: { level: 'hot' } },
      { type: 'notify_admin', params: { reason: '데모 페이지 반복 방문' } },
      { type: 'send_email', params: { trigger: 'demo_page_visited' } },
    ],
    cooldownMinutes: 2880,
    enabled: true,
  },
  {
    id: 'reply_received',
    name: '회신 수신 시 처리',
    conditions: [{ field: 'reply_count', operator: 'gte', value: 1 }],
    actions: [
      { type: 'update_interest', params: { level: 'warm' } },
      { type: 'notify_admin', params: { reason: '원장님 회신 수신' } },
    ],
    cooldownMinutes: 60,
    enabled: true,
  },
  {
    id: 'positive_reply_kakao',
    name: '긍정 회신 시 카카오 연결',
    conditions: [{ field: 'last_reply_sentiment', operator: 'eq', value: 'positive' }],
    actions: [
      { type: 'update_interest', params: { level: 'hot' } },
      { type: 'kakao_connect', params: {} },
      { type: 'notify_admin', params: { reason: '긍정 회신 - 카카오 연결 추천' } },
    ],
    cooldownMinutes: 1440,
    enabled: true,
  },
  {
    id: 'negative_reply_reapproach',
    name: '부정 회신 시 3개월 후 재접근',
    conditions: [{ field: 'last_reply_sentiment', operator: 'eq', value: 'negative' }],
    actions: [
      { type: 'pause_sequence', params: {} },
      { type: 'schedule_reapproach', params: { delay_days: 90, reason: 'negative_reply' } },
    ],
    cooldownMinutes: 43200,
    enabled: true,
  },
  {
    id: 'sequence_complete_no_response',
    name: '시퀀스 완료 무반응 시 6개월 후 재접근',
    conditions: [
      { field: 'stage', operator: 'eq', value: 'contacted' },
      { field: 'days_since_last_email', operator: 'gte', value: 180 },
      { field: 'open_count', operator: 'eq', value: 0 },
    ],
    actions: [
      { type: 'schedule_reapproach', params: { delay_days: 180, reason: 'sequence_complete_no_response' } },
    ],
    cooldownMinutes: 86400,
    enabled: true,
  },
  {
    id: 'bounced_pause',
    name: '바운스 시 시퀀스 일시 중지',
    conditions: [{ field: 'last_email_bounced', operator: 'is_true', value: true }],
    actions: [{ type: 'pause_sequence', params: {} }],
    cooldownMinutes: 43200,
    enabled: true,
  },
  {
    id: 'unsubscribe_stop',
    name: '수신거부/불만 처리',
    conditions: [{ field: 'last_email_complained', operator: 'is_true', value: true }],
    actions: [
      { type: 'pause_sequence', params: {} },
      { type: 'update_stage', params: { stage: 'closed_lost' } },
      { type: 'notify_admin', params: { reason: '수신거부 또는 불만 신고' } },
    ],
    cooldownMinutes: 525600,
    enabled: true,
  },
];

/**
 * 제품 카테고리별 동적 트리거 규칙 생성
 */
export function buildProductTypeTriggerRules(thresholds: ProductTriggerThresholds): TriggerRule[] {
  const rules: TriggerRule[] = [
    {
      id: 'email_opened_followup',
      name: `이메일 ${thresholds.openCountForFollowup}회 이상 열람 후 후속 이메일`,
      conditions: [
        { field: 'open_count', operator: 'gte', value: thresholds.openCountForFollowup },
        { field: 'click_count', operator: 'eq', value: 0 },
        { field: 'interest_level', operator: 'in', value: ['cold', 'warming'] },
      ],
      actions: [
        { type: 'update_interest', params: { level: 'warming' } },
        { type: 'send_email', params: { trigger: 'email_opened' } },
      ],
      cooldownMinutes: 1440,
      enabled: true,
    },
    {
      id: 'price_page_warm',
      name: `가격 페이지 ${thresholds.pricePageVisitsForWarm}회 이상 방문 시 워밍`,
      conditions: [{ field: 'price_page_visits', operator: 'gte', value: thresholds.pricePageVisitsForWarm }],
      actions: [
        { type: 'update_interest', params: { level: 'warm' } },
        { type: 'send_email', params: { trigger: 'price_page_visited' } },
      ],
      cooldownMinutes: 1440,
      enabled: true,
    },
  ];

  if (thresholds.instantQuoteOnClick) {
    rules.push({
      id: 'consumable_click_quote',
      name: '소모품 클릭 즉시 견적 이메일',
      conditions: [{ field: 'click_count', operator: 'gte', value: 1 }],
      actions: [
        { type: 'send_email', params: { trigger: 'instant_quote' } },
        { type: 'update_interest', params: { level: 'warm' } },
      ],
      cooldownMinutes: 1440,
      enabled: true,
    });
  }

  if (thresholds.demoPush) {
    rules.push({
      id: 'equipment_demo_push',
      name: '장비 제품 열람 3회+ 데모 유도',
      conditions: [{ field: 'open_count', operator: 'gte', value: 3 }],
      actions: [
        { type: 'send_email', params: { trigger: 'demo_invitation' } },
        { type: 'notify_admin', params: { reason: '장비 제품 반복 열람 - 데모 유도' } },
      ],
      cooldownMinutes: 4320,
      enabled: true,
    });
  }

  return rules;
}
