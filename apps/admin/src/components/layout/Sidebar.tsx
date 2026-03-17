import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '',
    items: [{ to: '/dashboard', label: '대시보드', icon: '📊' }],
  },
  {
    label: '데이터',
    items: [
      { to: '/hospitals', label: '병원 DB', icon: '🏥' },
      { to: '/networks', label: '네트워크/체인', icon: '🔗' },
      { to: '/crawls', label: '크롤 관리', icon: '📡' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/crm', label: '고객 대시보드', icon: '🏥' },
      { to: '/crm/hospitals', label: '병원 관리', icon: '🏢' },
      { to: '/crm/products', label: '제품 관리', icon: '📦' },
      { to: '/crm/equipment', label: '장비/소모품', icon: '🔧', disabled: true },
      { to: '/crm/activities', label: '활동 기록', icon: '📝', disabled: true },
      { to: '/crm/reports', label: 'MADMEDCHECK 리포트', icon: '📋', disabled: true },
    ],
  },
  {
    label: '영업',
    items: [
      { to: '/leads', label: '리드', icon: '👤' },
      { to: '/pipeline', label: '파이프라인', icon: '📋' },
      { to: '/emails', label: '이메일', icon: '📧' },
      { to: '/coldmail', label: '콜드메일', icon: '✉️' },
      { to: '/demos', label: '데모', icon: '📅' },
    ],
  },
  {
    label: '분석',
    items: [
      { to: '/costs', label: '비용 관리', icon: '💰' },
      { to: '/reports', label: '리포트', icon: '📈' },
    ],
  },
  {
    label: '시스템',
    items: [{ to: '/settings', label: '설정', icon: '⚙️', disabled: true }],
  },
];

function activeLinkClass({ isActive }: { isActive: boolean }): string {
  const base =
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
  return isActive
    ? `${base} bg-slate-700 text-white`
    : `${base} text-gray-300 hover:bg-slate-800 hover:text-white`;
}

function SidebarItem({ item }: { item: NavItem }): ReactNode {
  const navigate = useNavigate();

  if (item.disabled) {
    return (
      <span
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 cursor-not-allowed opacity-60"
      >
        <span className="text-base">{item.icon}</span>
        <span>{item.label}</span>
        <span className="ml-auto rounded bg-slate-700 px-1.5 py-0.5 text-[9px] text-slate-400">준비중</span>
      </span>
    );
  }

  return (
    <NavLink to={item.to} end={item.to === '/dashboard'} className={activeLinkClass}>
      <span className="text-base">{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar(): ReactNode {
  return (
    <aside className="flex h-screen w-60 flex-col bg-slate-900">
      <div className="flex h-14 items-center border-b border-slate-700 px-4">
        <h1 className="text-lg font-bold text-white">MADMEDSALES</h1>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
            {group.label ? (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.label}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarItem key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
