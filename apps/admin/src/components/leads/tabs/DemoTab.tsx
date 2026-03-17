import type { ReactNode } from 'react';
import type { LeadDemo } from '../../../hooks/use-lead-demos';

const DEMO_TYPE_LABELS: Record<string, string> = {
  visit: '방문 데모',
  online: '온라인 데모',
  self_video: '셀프 영상',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: '예정',
  completed: '완료',
  cancelled: '취소',
  no_show: '노쇼',
};

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

interface DemoTabProps {
  demos: LeadDemo[];
  loading: boolean;
  error: string | null;
}

export function DemoTab({ demos, loading, error }: DemoTabProps): ReactNode {
  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (demos.length === 0) {
    return <p className="text-sm text-gray-400">데모 이력이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {demos.map((demo) => (
        <div key={demo.id} className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                🏥 {DEMO_TYPE_LABELS[demo.demo_type] ?? demo.demo_type}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                demo.status === 'completed'
                  ? 'bg-green-50 text-green-700'
                  : demo.status === 'cancelled' || demo.status === 'no_show'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-blue-50 text-blue-700'
              }`}>
                {STATUS_LABELS[demo.status] ?? demo.status}
              </span>
            </div>
          </div>

          <dl className="space-y-1 text-xs text-gray-600">
            <div className="flex gap-2">
              <dt className="text-gray-400 w-12 shrink-0">예정일</dt>
              <dd>{formatDate(demo.scheduled_at)}</dd>
            </div>
            {demo.completed_at && (
              <div className="flex gap-2">
                <dt className="text-gray-400 w-12 shrink-0">완료일</dt>
                <dd>{formatDate(demo.completed_at)}</dd>
              </div>
            )}
            {demo.notes && (
              <div className="flex gap-2 mt-2">
                <dt className="text-gray-400 w-12 shrink-0">메모</dt>
                <dd className="text-gray-700 whitespace-pre-wrap">{demo.notes}</dd>
              </div>
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}
