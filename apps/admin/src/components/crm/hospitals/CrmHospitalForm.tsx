import { type ReactNode, useState } from 'react';
import type { CrmHospital, CustomerGrade, HealthStatus } from '@madmedsales/shared';
import { useCrmFranchises } from '../../../hooks/use-crm-products';

interface Props {
  initial?: Partial<CrmHospital>;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function CrmHospitalForm({ initial, onSave, onCancel }: Props): ReactNode {
  const [name, setName] = useState(initial?.name ?? '');
  const [branchName, setBranchName] = useState(initial?.branch_name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [kakaoChannel, setKakaoChannel] = useState(initial?.kakao_channel ?? '');
  const [grade, setGrade] = useState<CustomerGrade>(initial?.customer_grade ?? 'B');
  const [health, setHealth] = useState<HealthStatus>(initial?.health_status ?? 'green');
  const [franchiseId, setFranchiseId] = useState(initial?.franchise_id ?? '');
  const [reportEnabled, setReportEnabled] = useState(initial?.report_enabled ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const { data: franchises } = useCrmFranchises();

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        branch_name: branchName || null,
        address: address || null,
        region: region || null,
        phone: phone || null,
        email: email || null,
        website: website || null,
        kakao_channel: kakaoChannel || null,
        customer_grade: grade,
        health_status: health,
        franchise_id: franchiseId || null,
        report_enabled: reportEnabled,
        notes: notes || null,
      });
    } catch {
      // handled upstream
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-200 space-y-4">
      <h2 className="text-sm font-semibold text-gray-600">병원 정보 편집</h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">병원명 *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">지점명</label>
          <input type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)}
            placeholder="유성점" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">지역</label>
          <input type="text" value={region} onChange={(e) => setRegion(e.target.value)}
            placeholder="서울" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2 lg:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">주소</label>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">전화번호</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">이메일</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">웹사이트</label>
          <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">카카오채널</label>
          <input type="text" value={kakaoChannel} onChange={(e) => setKakaoChannel(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">등급</label>
          <select value={grade} onChange={(e) => setGrade(e.target.value as CustomerGrade)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="VIP">VIP</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">건강도</label>
          <select value={health} onChange={(e) => setHealth(e.target.value as HealthStatus)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="green">건강</option>
            <option value="yellow">보통</option>
            <option value="orange">주의</option>
            <option value="red">위험</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">프랜차이즈</label>
          <select value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="">없음</option>
            {(franchises ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
            <input type="checkbox" checked={reportEnabled} onChange={(e) => setReportEnabled(e.target.checked)} />
            리포트 발송
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">메모</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          취소
        </button>
        <button onClick={handleSubmit} disabled={!name.trim() || saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
