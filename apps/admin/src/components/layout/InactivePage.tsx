import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  phase?: string;
}

export function InactivePage({ title, phase = 'Phase 3' }: Props): ReactNode {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="rounded-lg border border-gray-100 bg-white p-10 text-center shadow-sm">
        <span className="text-4xl">🔒</span>
        <h2 className="mt-4 text-lg font-bold text-slate-800">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">
          이 기능은 {phase}에서 활성화됩니다
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          대시보드로 이동
        </button>
      </div>
    </div>
  );
}
