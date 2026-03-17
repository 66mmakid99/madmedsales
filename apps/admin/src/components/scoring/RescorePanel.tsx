// v1.0 - 2026-03-16: TORR RF 전용 재채점 패널
import { useState, type ReactNode } from 'react';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../hooks/use-api';
import type { Product } from '@madmedsales/shared';

interface RescoreResult {
  dry_run: boolean;
  before: Record<string, number>;
  after: Record<string, number> | null;
  processed: number;
  failed: number;
  leads_created: number;
  duration_ms: number;
}

const GRADE_COLORS: Record<string, string> = {
  S: 'bg-red-500',
  A: 'bg-orange-400',
  B: 'bg-yellow-400',
  C: 'bg-gray-300',
  EXCLUDE: 'bg-slate-200',
};

function GradeBar({ dist, label }: { dist: Record<string, number>; label: string }): ReactNode {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="text-xs text-gray-400">{label}: 데이터 없음</p>;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-500">{label} (총 {total}건)</p>
      <div className="flex h-5 w-full overflow-hidden rounded-full">
        {(['S', 'A', 'B', 'C', 'EXCLUDE'] as const).map((g) =>
          dist[g] > 0 ? (
            <div
              key={g}
              className={`${GRADE_COLORS[g]} flex items-center justify-center text-[10px] font-bold text-white`}
              style={{ width: `${(dist[g] / total) * 100}%` }}
              title={`${g}: ${dist[g]}건`}
            >
              {dist[g] / total > 0.05 ? `${g}:${dist[g]}` : ''}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

export function RescorePanel(): ReactNode {
  const { data: productsData } = useApi<{ products: Product[] }>('/api/crm/products');
  const products = productsData?.products ?? [];

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [result, setResult] = useState<RescoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handlePreview(): Promise<void> {
    if (!selectedProductId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: RescoreResult }>('/api/scoring/rescore', {
        method: 'POST',
        body: JSON.stringify({ product_id: selectedProductId, dry_run: true }),
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '미리보기 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleRescore(): Promise<void> {
    if (!selectedProductId) return;
    setLoading(true);
    setError(null);
    setShowConfirm(false);
    try {
      const res = await apiFetch<{ data: RescoreResult }>('/api/scoring/rescore', {
        method: 'POST',
        body: JSON.stringify({ product_id: selectedProductId, dry_run: false }),
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '재채점 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-gray-900">재채점 패널</h3>

      <div className="mb-4 flex items-center gap-3">
        <select
          value={selectedProductId}
          onChange={(e) => { setSelectedProductId(e.target.value); setResult(null); }}
          className="rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">제품 선택</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={() => void handlePreview()}
          disabled={!selectedProductId || loading}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? '처리 중...' : '미리보기'}
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!selectedProductId || loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          재채점 실행
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {result && (
        <div className="space-y-3">
          <GradeBar dist={result.before} label="재채점 전" />
          {result.after && <GradeBar dist={result.after} label="재채점 후" />}
          {!result.dry_run && (
            <p className="text-xs text-gray-500">
              처리 {result.processed}건 / 실패 {result.failed}건 / 리드 생성 {result.leads_created}건 /
              소요 {(result.duration_ms / 1000).toFixed(1)}초
            </p>
          )}
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 shadow-xl">
            <p className="mb-4 text-sm font-medium text-gray-800">
              기존 매칭 스코어를 모두 초기화하고 재채점합니다. 계속하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="rounded-lg border px-4 py-2 text-sm">
                취소
              </button>
              <button
                onClick={() => void handleRescore()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
