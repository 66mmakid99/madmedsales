import { useApi } from './use-api';

export interface LeadEmail {
  id: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: string;
  sent_at: string | null;
  step_number: number | null;
  created_at: string;
  opened_at: string | null;
  clicked_at: string | null;
}

interface LeadEmailsResult {
  emails: LeadEmail[];
}

export function useLeadEmails(leadId: string | undefined): ReturnType<typeof useApi<LeadEmailsResult>> {
  return useApi<LeadEmailsResult>(leadId ? `/api/leads/${leadId}/emails` : null);
}
