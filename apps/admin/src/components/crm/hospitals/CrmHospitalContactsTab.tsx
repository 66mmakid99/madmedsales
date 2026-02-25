import { type ReactNode, useState } from 'react';
import type { CrmContact } from '@madmedsales/shared';
import type { CrmHospitalDetail } from '../../../hooks/use-crm-hospitals';
import { createCrmContact, deleteCrmContact } from '../../../hooks/use-crm-hospitals';

interface Props {
  hospital: CrmHospitalDetail;
  onUpdate: () => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  kakao: '카카오톡',
  phone: '전화',
  email: '이메일',
  visit: '방문',
};

function ContactCard({ contact, onDelete }: { contact: CrmContact; onDelete: () => void }): ReactNode {
  return (
    <div className={`rounded-lg bg-white p-4 shadow-sm border ${contact.is_primary ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900">{contact.name}</p>
            {contact.is_primary ? (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                대표
              </span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{contact.role ?? '-'}</p>
        </div>
        <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">삭제</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-xs text-gray-400">전화</p>
          <p className="text-gray-700">{contact.phone ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">이메일</p>
          <p className="text-gray-700">{contact.email ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">카카오</p>
          <p className="text-gray-700">{contact.kakao_id ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">선호 연락</p>
          <p className="text-gray-700">{CHANNEL_LABELS[contact.preferred_contact] ?? contact.preferred_contact}</p>
        </div>
      </div>
    </div>
  );
}

export function CrmHospitalContactsTab({ hospital, onUpdate }: Props): ReactNode {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [kakaoId, setKakaoId] = useState('');
  const [preferred, setPreferred] = useState('kakao');
  const [isPrimary, setIsPrimary] = useState(false);

  const handleAdd = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCrmContact({
        hospital_id: hospital.id,
        tenant_id: hospital.tenant_id,
        name: name.trim(),
        role: role || undefined,
        phone: phone || undefined,
        email: email || undefined,
        kakao_id: kakaoId || undefined,
        preferred_contact: preferred,
        is_primary: isPrimary,
      });
      setAdding(false);
      resetForm();
      onUpdate();
    } catch {
      // error silently
    } finally {
      setSaving(false);
    }
  };

  const resetForm = (): void => {
    setName('');
    setRole('');
    setPhone('');
    setEmail('');
    setKakaoId('');
    setPreferred('kakao');
    setIsPrimary(false);
  };

  const handleDelete = async (contactId: string): Promise<void> => {
    if (!confirm('이 담당자를 삭제하시겠습니까?')) return;
    await deleteCrmContact(contactId);
    onUpdate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-600">담당자 ({hospital.contacts.length}명)</h2>
        <button
          onClick={() => { setAdding(!adding); if (adding) resetForm(); }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          {adding ? '취소' : '+ 담당자 추가'}
        </button>
      </div>

      {/* 인라인 추가 폼 */}
      {adding ? (
        <div className="rounded-lg bg-gray-50 p-4 border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">이름 *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">직책</label>
              <input type="text" value={role} onChange={(e) => setRole(e.target.value)}
                placeholder="원장, 실장, 간호사" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">전화번호</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">이메일</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">카카오 ID</label>
              <input type="text" value={kakaoId} onChange={(e) => setKakaoId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">선호 연락</label>
              <select value={preferred} onChange={(e) => setPreferred(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="kakao">카카오톡</option>
                <option value="phone">전화</option>
                <option value="email">이메일</option>
                <option value="visit">방문</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
              대표 담당자
            </label>
            <button onClick={handleAdd} disabled={!name.trim() || saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-40">
              {saving ? '저장 중...' : '추가'}
            </button>
          </div>
        </div>
      ) : null}

      {/* 담당자 카드 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {hospital.contacts.map((contact) => (
          <ContactCard key={contact.id} contact={contact} onDelete={() => handleDelete(contact.id)} />
        ))}
      </div>

      {hospital.contacts.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-sm">등록된 담당자가 없습니다.</div>
      ) : null}
    </div>
  );
}
