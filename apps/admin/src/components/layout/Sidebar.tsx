import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '대시보드', icon: '📊' },
  { to: '/leads', label: '리드', icon: '👤' },
  { to: '/pipeline', label: '파이프라인', icon: '📈' },
  { to: '/emails', label: '이메일', icon: '✉️' },
  { to: '/demos', label: '데모', icon: '🎯' },
  { to: '/hospitals', label: '병원 DB', icon: '🏥' },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
  return isActive
    ? `${base} bg-blue-50 text-blue-700`
    : `${base} text-gray-600 hover:bg-gray-100 hover:text-gray-900`;
}

export function Sidebar(): ReactNode {
  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-white">
      <div className="flex h-14 items-center border-b px-4">
        <h1 className="text-lg font-bold text-gray-900">MADMEDSALES</h1>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={navLinkClass}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3">
        <NavLink
          to="/settings"
          className={navLinkClass}
        >
          <span className="text-base">⚙️</span>
          <span>설정</span>
        </NavLink>
      </div>
    </aside>
  );
}
