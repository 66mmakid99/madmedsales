import type { ReactNode } from 'react';
import { useState } from 'react';
import type { LeadEmail } from '../../../hooks/use-lead-emails';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_LABELS: Record<string, string> = {
  queued: '대기',
  sent: '발송',
  delivered: '전달',
  opened: '열람',
  clicked: '클릭',
  bounced: '반송',
  failed: '실패',
};

interface EmailCardProps {
  email: LeadEmail;
  expanded: boolean;
  onToggle: () => void;
}

function EmailCard({ email, expanded, onToggle }: EmailCardProps): ReactNode {
  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                {email.step_number ? `Step ${email.step_number}` : '이메일'}
              </span>
              <span className="text-xs text-gray-400">{formatDate(email.sent_at ?? email.created_at)}</span>
            </div>
            <p className="text-sm font-medium text-gray-900 truncate">{email.subject}</p>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className={`px-2 py-0.5 rounded-full font-medium ${
            email.status === 'sent' || email.status === 'delivered'
              ? 'bg-green-50 text-green-700'
              : email.status === 'bounced' || email.status === 'failed'
              ? 'bg-red-50 text-red-600'
              : 'bg-gray-50 text-gray-500'
          }`}>
            {STATUS_LABELS[email.status] ?? email.status}
          </span>

          {email.opened_at ? (
            <span className="text-green-600">
              열람 ✓ {formatDate(email.opened_at)}
            </span>
          ) : (
            <span className="text-gray-400">열람 -</span>
          )}

          {email.clicked_at ? (
            <span className="text-blue-600">클릭 ✓</span>
          ) : null}
        </div>
      </div>

      <div className="border-t">
        <button
          onClick={onToggle}
          className="w-full px-4 py-2 text-left text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-1"
        >
          {expanded ? '▲ 본문 접기' : '▼ 본문 펼치기'}
        </button>

        {expanded && (
          <div className="border-t bg-gray-50 p-4">
            {email.body_html ? (
              <div
                className="text-sm prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: email.body_html }}
              />
            ) : email.body_text ? (
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{email.body_text}</pre>
            ) : (
              <p className="text-sm text-gray-400">본문 없음</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface EmailTabProps {
  emails: LeadEmail[];
  loading: boolean;
  error: string | null;
}

export function EmailTab({ emails, loading, error }: EmailTabProps): ReactNode {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (emails.length === 0) {
    return <p className="text-sm text-gray-400">발송된 이메일이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {emails.map((email) => (
        <EmailCard
          key={email.id}
          email={email}
          expanded={expandedId === email.id}
          onToggle={() => setExpandedId(expandedId === email.id ? null : email.id)}
        />
      ))}
    </div>
  );
}
