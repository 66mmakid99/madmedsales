// v1.0 - 2026-02-20
// Email sending service via Resend API (fetch-based for Workers compatibility)

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = 'MADMEDSALES <noreply@madmedsales.com>';
const REPLY_TO = 'hello@madmedsales.com';

interface SendEmailInput {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  leadId: string;
  emailId: string;
  grade: string | null;
  stepNumber: number | null;
}

interface SendEmailEnv {
  RESEND_API_KEY: string;
}

interface ResendResponse {
  id: string;
}

function isResendResponse(value: unknown): value is ResendResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['id'] === 'string'
  );
}

export async function sendEmail(
  input: SendEmailInput,
  env: SendEmailEnv
): Promise<string> {
  const tags: { name: string; value: string }[] = [];

  if (input.grade) {
    tags.push({ name: 'grade', value: input.grade });
  }
  if (input.stepNumber !== null) {
    tags.push({ name: 'sequence_step', value: String(input.stepNumber) });
  }

  const payload = {
    from: FROM_EMAIL,
    to: [input.to],
    reply_to: REPLY_TO,
    subject: input.subject,
    html: input.bodyHtml,
    text: input.bodyText ?? undefined,
    headers: {
      'X-Lead-Id': input.leadId,
      'X-Email-Id': input.emailId,
    },
    tags,
  };

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `Resend API error: ${response.status} - ${errBody}`
      );
    }

    const data: unknown = await response.json();
    if (!isResendResponse(data)) {
      throw new Error('Invalid response from Resend API');
    }

    return data.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown send error';
    throw new Error(`Email send failed: ${message}`);
  }
}
