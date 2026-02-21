export { KEYWORD_DICTIONARY, KEYWORD_CATEGORIES, UNIT_TYPES, findStandardName, resolveAmbiguousUnit } from './keyword-dictionary';
export type { KeywordEntry, KeywordCategory, UnitType } from './keyword-dictionary';
export { COMPOUND_WORDS, decomposeCompoundWord } from './compound-words';
export type { CompoundWordEntry } from './compound-words';

export const LEAD_STAGES = [
  'new',
  'contacted',
  'responded',
  'kakao_connected',
  'demo_scheduled',
  'demo_done',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
  'nurturing',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const GRADES = ['S', 'A', 'B', 'C', 'EXCLUDE'] as const;
export type Grade = (typeof GRADES)[number];

export const INTEREST_LEVELS = ['cold', 'warming', 'warm', 'hot'] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const EQUIPMENT_CATEGORIES = ['rf', 'hifu', 'laser', 'booster', 'body', 'lifting', 'other'] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const DEMO_TYPES = ['online', 'visit', 'self_video'] as const;
export type DemoType = (typeof DEMO_TYPES)[number];

export const DEMO_STATUSES = [
  'requested',
  'confirmed',
  'preparing',
  'in_progress',
  'completed',
  'evaluated',
  'cancelled',
] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];

export const EMAIL_STATUSES = ['queued', 'sent', 'delivered', 'bounced', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_EVENT_TYPES = [
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

export const ACTIVITY_TYPES = [
  'email_sent',
  'email_opened',
  'email_clicked',
  'email_replied',
  'email_bounced',
  'email_unsubscribed',
  'kakao_connected',
  'kakao_sent',
  'kakao_replied',
  'demo_requested',
  'demo_completed',
  'demo_evaluated',
  'page_visited',
  'stage_changed',
  'note_added',
  'sales_assigned',
  'ai_analysis',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const SEQUENCE_PURPOSES = [
  'intro',
  'case_study',
  'competition',
  'price_offer',
  'final_followup',
] as const;
export type SequencePurpose = (typeof SEQUENCE_PURPOSES)[number];

export const PURCHASE_INTENTS = ['immediate', 'considering', 'hold', 'no_interest'] as const;
export type PurchaseIntent = (typeof PURCHASE_INTENTS)[number];

export const PAYMENT_METHODS = ['lump_sum', 'installment', 'rental', 'capital'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
