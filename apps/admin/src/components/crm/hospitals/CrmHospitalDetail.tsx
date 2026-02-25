import { type ReactNode, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCrmHospitalDetail } from '../../../hooks/use-crm-hospitals';
import { CrmHospitalInfoTab } from './CrmHospitalInfoTab';
import { CrmHospitalEquipmentTab } from './CrmHospitalEquipmentTab';
import { CrmHospitalContactsTab } from './CrmHospitalContactsTab';

const GRADE_STYLES: Record<string, string> = {
  VIP: 'bg-purple-100 text-purple-700',
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-gray-100 text-gray-600',
  C: 'bg-yellow-100 text-yellow-700',
};

const HEALTH_DOTS: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
};

const TABS = [
  { key: 'info', label: '기본 정보' },
  { key: 'equipment', label: '장비' },
  { key: 'contacts', label: '담당자' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function CrmHospitalDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useCrmHospitalDetail(id);
  const [activeTab, setActiveTab] = useState<TabKey>('info');

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-400">로딩 중...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-center">
        <p className="text-red-600">{error ?? '병원 정보를 불러올 수 없습니다.'}</p>
        <button onClick={() => navigate('/crm/hospitals')} className="mt-3 text-sm text-blue-600 hover:underline">
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  const displayName = data.branch_name ? `${data.name} ${data.branch_name}` : data.name;

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/crm/hospitals')}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          &larr; 목록
        </button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${GRADE_STYLES[data.customer_grade] ?? ''}`}>
            {data.customer_grade}
          </span>
          <span className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${HEALTH_DOTS[data.health_status] ?? 'bg-gray-300'}`} />
            <span className="text-xs text-gray-500">{data.health_status}</span>
          </span>
        </div>
      </div>

      {/* 탭 */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.key === 'equipment' && data.equipment.length > 0 ? (
                <span className="ml-1 text-xs text-gray-400">({data.equipment.length})</span>
              ) : null}
              {tab.key === 'contacts' && data.contacts.length > 0 ? (
                <span className="ml-1 text-xs text-gray-400">({data.contacts.length})</span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === 'info' ? <CrmHospitalInfoTab hospital={data} onUpdate={refetch} /> : null}
      {activeTab === 'equipment' ? <CrmHospitalEquipmentTab hospital={data} onUpdate={refetch} /> : null}
      {activeTab === 'contacts' ? <CrmHospitalContactsTab hospital={data} onUpdate={refetch} /> : null}
    </div>
  );
}
