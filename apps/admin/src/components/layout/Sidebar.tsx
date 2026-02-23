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
    label: '영업',
    items: [
      { to: '/leads', label: '리드', icon: '👤', disabled: true },
      { to: '/emails', label: '이메일', icon: '📧', disabled: true },
      { to: '/pipeline', label: '파이프라인', icon: '📋', disabled: true },
      { to: '/demos', label: '데모', icon: '📅', disabled: true },
    ],
  },
  {
    label: '분석',
    items: [
      { to: '/costs', label: '비용 관리', icon: '💰' },
      { to: '/reports', label: '리포트', icon: '📈', disabled: true },
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
      <button
        onClick={() => navigate(item.to)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-800"
      >
        <span className="text-base">{item.icon}</span>
        <span>{item.label}</span>
        <span className="ml-auto text-[10px]">🔒</span>
      </button>
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
