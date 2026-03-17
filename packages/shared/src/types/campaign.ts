// ─── Email Campaign (콜드메일 파이프라인) ────────────────

export const CAMPAIGN_STATUSES = [
  'draft', 'reviewing', 'approved', 'sending', 'completed', 'paused',
] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];

export const CAMPAIGN_EMAIL_STATUSES = [
  'pending', 'approved', 'rejected', 'sent', 'bounced', 'failed',
] as const;
export type CampaignEmailStatus = typeof CAMPAIGN_EMAIL_STATUSES[number];

export interface EmailCampaign {
  id: string;
  name: string;
  product_id: string | null;
  purpose: string;
  target_filter: Record<string, unknown>;
  total_count: number;
  draft_count: number;
  approved_count: number;
  sent_count: number;
  rejected_count: number;
  status: CampaignStatus;
  scheduled_at: string | null;
  daily_limit: number;
  send_hour_start: number;
  send_hour_end: number;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // 서버 응답 시 추가 집계 필드
  draft_failed_count?: number;
  pending_count?: number;
}

export interface CampaignEmail {
  id: string;
  campaign_id: string;
  hospital_email_id: string;
  hospital_id: string;
  to_email: string;
  hospital_name: string;
  hospital_sido: string | null;
  hospital_sigungu: string | null;
  director_name: string | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  ai_prompt_used: string | null;
  status: CampaignEmailStatus;
  admin_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  resend_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  bounce_reason: string | null;
  created_at: string;
  updated_at: string;
}
