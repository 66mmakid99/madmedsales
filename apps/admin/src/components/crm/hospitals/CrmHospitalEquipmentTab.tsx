import { type ReactNode, useState } from 'react';
import type { CrmHospitalDetail, CrmEquipmentWithProduct } from '../../../hooks/use-crm-hospitals';
import { createCrmEquipment, deleteCrmEquipment } from '../../../hooks/use-crm-hospitals';
import { useCrmProducts } from '../../../hooks/use-crm-products';

interface Props {
  hospital: CrmHospitalDetail;
  onUpdate: () => void;
}

function warrantyLabel(warrantyEnd: string | null): { text: string; color: string } {
  if (!warrantyEnd) return { text: '미설정', color: 'text-gray-400' };
  const end = new Date(warrantyEnd);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { text: '만료', color: 'text-red-600' };
  if (daysLeft < 60) return { text: `${daysLeft}일 남음`, color: 'text-orange-600' };
  return { text: warrantyEnd, color: 'text-green-600' };
}

const STATUS_LABELS: Record<string, string> = {
  active: '정상',
  inactive: '비활성',
  maintenance: '수리중',
  sold: '매각',
  disposed: '폐기',
};

function EquipmentRow({ eq, onDelete }: { eq: CrmEquipmentWithProduct; onDelete: () => void }): ReactNode {
  const warranty = warrantyLabel(eq.warranty_end);

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-3 text-sm font-medium text-gray-900">
        {eq.product?.name ?? '-'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{eq.model_variant ?? '-'}</td>
      <td className="px-4 py-3 text-sm text-gray-600 font-mono">{eq.serial_number ?? '-'}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{eq.delivered_at ?? '-'}</td>
      <td className={`px-4 py-3 text-sm font-medium ${warranty.color}`}>{warranty.text}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{eq.firmware_version ?? '-'}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{STATUS_LABELS[eq.status] ?? eq.status}</td>
      <td className="px-4 py-3">
        <button
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-700"
        >
          삭제
        </button>
      </td>
    </tr>
  );
}

export function CrmHospitalEquipmentTab({ hospital, onUpdate }: Props): ReactNode {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data: products } = useCrmProducts();

  // 인라인 폼 상태
  const [productId, setProductId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [modelVariant, setModelVariant] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [firmwareVersion, setFirmwareVersion] = useState('');

  const handleAdd = async (): Promise<void> => {
    if (!productId) return;
    setSaving(true);
    try {
      await createCrmEquipment({
        hospital_id: hospital.id,
        tenant_id: hospital.tenant_id,
        product_id: productId,
        serial_number: serialNumber || undefined,
        model_variant: modelVariant || undefined,
        delivered_at: deliveredAt || undefined,
        firmware_version: firmwareVersion || undefined,
      });
      setAdding(false);
      setProductId('');
      setSerialNumber('');
      setModelVariant('');
      setDeliveredAt('');
      setFirmwareVersion('');
      onUpdate();
    } catch {
      // error silently
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (eqId: string): Promise<void> => {
    if (!confirm('이 장비를 삭제하시겠습니까?')) return;
    await deleteCrmEquipment(eqId);
    onUpdate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-600">납품 장비 ({hospital.equipment.length}대)</h2>
        <button
          onClick={() => setAdding(!adding)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          {adding ? '취소' : '+ 장비 추가'}
        </button>
      </div>

      {/* 인라인 추가 폼 */}
      {adding ? (
        <div className="rounded-lg bg-gray-50 p-4 border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">제품</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">선택...</option>
                {(products ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">모델</label>
              <input
                type="text"
                value={modelVariant}
                onChange={(e) => setModelVariant(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="KE-MT"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">시리얼 번호</label>
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">납품일</label>
              <input
                type="date"
                value={deliveredAt}
                onChange={(e) => setDeliveredAt(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">펌웨어</label>
              <input
                type="text"
                value={firmwareVersion}
                onChange={(e) => setFirmwareVersion(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="v2.1.3"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={!productId || saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? '저장 중...' : '추가'}
            </button>
          </div>
        </div>
      ) : null}

      {/* 장비 테이블 */}
      <div className="rounded-lg bg-white shadow-sm border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">제품명</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">모델</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">S/N</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">납품일</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">보증</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">펌웨어</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">상태</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {hospital.equipment.map((eq) => (
                <EquipmentRow key={eq.id} eq={eq} onDelete={() => handleDelete(eq.id)} />
              ))}
            </tbody>
          </table>
        </div>
        {hospital.equipment.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">등록된 장비가 없습니다.</div>
        ) : null}
      </div>
    </div>
  );
}
