import type { ReactNode } from 'react';
import type { LeadActivity } from '@madmedsales/shared';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface NoteTabProps {
  activities: LeadActivity[];
  loading: boolean;
  error: string | null;
}

export function NoteTab({ activities, loading, error }: NoteTabProps): ReactNode {
  const notes = activities.filter((a) => a.activity_type === 'note_added');

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (notes.length === 0) {
    return <p className="text-sm text-gray-400">메모가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <div key={note.id} className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">📝 메모</span>
            <span className="text-xs text-gray-400">{formatDate(note.created_at)}</span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">
            {note.description ?? note.title ?? ''}
          </p>
        </div>
      ))}
    </div>
  );
}
