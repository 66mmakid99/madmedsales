// v1.0 - 2026-03-16: 이메일 시퀀스 편집기 (TORR RF 전용)
import { useState, type ReactNode } from 'react';
import { useApi } from '../../hooks/use-api';
import { apiFetch } from '../../lib/api';
import type { Product } from '@madmedsales/shared';

interface Sequence {
  id: string;
  name: string;
  target_grade: string;
  product_id: string | null;
  is_active: boolean;
  steps: SequenceStep[];
}

interface SequenceStep {
  id: string;
  sequence_id: string;
  step_number: number;
  delay_days: number;
  purpose: string | null;
  email_guide: string | null;
}

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-red-100 text-red-700',
  A: 'bg-orange-100 text-orange-700',
  B: 'bg-yellow-100 text-yellow-700',
  C: 'bg-gray-100 text-gray-600',
};

export function SequenceEditor(): ReactNode {
  const { data: productsData } = useApi<{ products: Product[] }>('/api/crm/products');
  const products = productsData?.products ?? [];

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const { data: seqData, refetch } = useApi<{ sequences: Sequence[] }>(
    selectedProductId ? `/api/sequences?product_id=${selectedProductId}` : null
  );
  const sequences = seqData?.sequences ?? [];

  const [editingStep, setEditingStep] = useState<{ seqId: string; stepId: string; guide: string } | null>(null);
  const [previewStep, setPreviewStep] = useState<{ guide: string; purpose: string | null; stepNumber: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    if (!editingStep) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiFetch(`/api/sequences/steps/${editingStep.stepId}`, {
        method: 'PATCH',
        body: JSON.stringify({ email_guide: editingStep.guide }),
      });
      setEditingStep(null);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-gray-900">이메일 시퀀스 편집기</h3>

      <div className="mb-4">
        <select
          value={selectedProductId}
          onChange={(e) => { setSelectedProductId(e.target.value); setEditingStep(null); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">제품 선택</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {sequences.length === 0 && selectedProductId && (
        <p className="text-sm text-gray-400">해당 제품의 시퀀스가 없습니다.</p>
      )}

      {previewStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPreviewStep(null)}>
          <div className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">
                Step {previewStep.stepNumber} 이메일 가이드 미리보기
                {previewStep.purpose && <span className="ml-2 font-normal text-gray-500">— {previewStep.purpose}</span>}
              </p>
              <button onClick={() => setPreviewStep(null)} className="text-xs text-gray-400 hover:text-gray-600">닫기</button>
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">{previewStep.guide}</pre>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sequences.map((seq) => (
          <div key={seq.id} className="rounded-lg border border-gray-200">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{seq.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${GRADE_COLORS[seq.target_grade] ?? 'bg-gray-100 text-gray-600'}`}>
                  {seq.target_grade}
                </span>
              </div>
              <span className={`text-xs ${seq.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                {seq.is_active ? '활성' : '비활성'}
              </span>
            </div>

            <div className="divide-y">
              {(seq.steps ?? []).sort((a, b) => a.step_number - b.step_number).map((step) => {
                const isEditing = editingStep?.stepId === step.id;
                return (
                  <div key={step.id} className="px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-blue-600">Step {step.step_number}</span>
                        <span className="text-xs text-gray-500">D+{step.delay_days}</span>
                        {step.purpose && (
                          <span className="text-xs text-gray-400">— {step.purpose}</span>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex gap-2">
                          {step.email_guide && (
                            <button
                              onClick={() => setPreviewStep({ guide: step.email_guide!, purpose: step.purpose, stepNumber: step.step_number })}
                              className="text-xs text-gray-400 hover:underline"
                            >
                              미리보기
                            </button>
                          )}
                          <button
                            onClick={() => setEditingStep({ seqId: seq.id, stepId: step.id, guide: step.email_guide ?? '' })}
                            className="text-xs text-blue-500 hover:underline"
                          >
                            편집
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingStep.guide}
                          onChange={(e) => setEditingStep({ ...editingStep, guide: e.target.value })}
                          rows={4}
                          className="w-full rounded border border-blue-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="이메일 가이드 텍스트..."
                        />
                        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleSave()}
                            disabled={saving}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {saving ? '저장 중...' : '저장'}
                          </button>
                          <button
                            onClick={() => setEditingStep(null)}
                            className="rounded-lg border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {step.email_guide ?? <span className="italic text-gray-300">가이드 없음</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
