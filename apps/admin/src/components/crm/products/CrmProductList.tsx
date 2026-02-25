import { type ReactNode, useState } from 'react';
import { useCrmProducts, createCrmProduct, updateCrmProduct } from '../../../hooks/use-crm-products';
import type { CrmProduct, CrmConsumableSpec } from '@madmedsales/shared';

// 첫 테넌트 BRITZMEDI 고정 (Phase 2+에서 동적 전환)
const DEFAULT_TENANT_ID = 'a1b2c3d4-0001-4000-8000-000000000001';

function ConsumableTag({ spec }: { spec: CrmConsumableSpec }): ReactNode {
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      {spec.name}
      {spec.cycle_days ? ` (${spec.cycle_days}일)` : ''}
    </span>
  );
}

function ProductCard({ product, onEdit }: { product: CrmProduct; onEdit: () => void }): ReactNode {
  const consumables = (product.consumables ?? []) as CrmConsumableSpec[];

  return (
    <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{product.name}</h3>
          {product.model_variants && product.model_variants.length > 0 ? (
            <p className="text-sm text-gray-500 mt-0.5">
              모델: {product.model_variants.join(', ')}
            </p>
          ) : null}
        </div>
        <button onClick={onEdit} className="text-xs text-blue-600 hover:text-blue-800">편집</button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-400">가격대</p>
          <p className="text-gray-700">{product.price_range ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">보증기간</p>
          <p className="text-gray-700">{product.warranty_months}개월</p>
        </div>
      </div>

      {consumables.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-gray-400 mb-1">소모품</p>
          <div className="flex flex-wrap gap-1">
            {consumables.map((c, i) => <ConsumableTag key={i} spec={c} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProductForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: CrmProduct;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(initial?.name ?? '');
  const [variants, setVariants] = useState(initial?.model_variants?.join(', ') ?? '');
  const [priceRange, setPriceRange] = useState(initial?.price_range ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState(String(initial?.warranty_months ?? 24));
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        tenant_id: initial?.tenant_id ?? DEFAULT_TENANT_ID,
        name: name.trim(),
        model_variants: variants ? variants.split(',').map((v) => v.trim()).filter(Boolean) : null,
        price_range: priceRange || null,
        warranty_months: Number(warrantyMonths) || 24,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg bg-gray-50 p-5 border border-gray-200 space-y-4">
      <h3 className="text-sm font-semibold text-gray-600">
        {initial ? '제품 편집' : '새 제품 등록'}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">제품명 *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">모델 (쉼표 구분)</label>
          <input type="text" value={variants} onChange={(e) => setVariants(e.target.value)}
            placeholder="KE-MT, BM-MT" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">가격대</label>
          <input type="text" value={priceRange} onChange={(e) => setPriceRange(e.target.value)}
            placeholder="2500~2800만원" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">보증기간 (개월)</label>
          <input type="number" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          취소
        </button>
        <button onClick={handleSave} disabled={!name.trim() || saving}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-40">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

export function CrmProductList(): ReactNode {
  const { data: products, loading, error, refetch } = useCrmProducts();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleCreate = async (body: Record<string, unknown>): Promise<void> => {
    await createCrmProduct(body);
    setAdding(false);
    refetch();
  };

  const handleUpdate = async (id: string, body: Record<string, unknown>): Promise<void> => {
    await updateCrmProduct(id, body);
    setEditingId(null);
    refetch();
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><p className="text-gray-400">로딩 중...</p></div>;
  }

  if (error) {
    return <div className="rounded-lg bg-red-50 p-6 text-center"><p className="text-red-600">{error}</p></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">제품 관리</h1>
        <button
          onClick={() => { setAdding(!adding); setEditingId(null); }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          {adding ? '취소' : '+ 제품 추가'}
        </button>
      </div>

      {adding ? (
        <ProductForm onSave={handleCreate} onCancel={() => setAdding(false)} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {(products ?? []).map((p) =>
          editingId === p.id ? (
            <ProductForm
              key={p.id}
              initial={p}
              onSave={(body) => handleUpdate(p.id, body)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <ProductCard key={p.id} product={p} onEdit={() => { setEditingId(p.id); setAdding(false); }} />
          )
        )}
      </div>

      {(!products || products.length === 0) && !adding ? (
        <div className="py-12 text-center text-gray-400">
          등록된 제품이 없습니다.
        </div>
      ) : null}
    </div>
  );
}
