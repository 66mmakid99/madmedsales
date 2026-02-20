import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/auth';

export function AppLayout(): ReactNode {
  const setSession = useAuthStore((s) => s.setSession);

  const handleLogout = async (): Promise<void> => {
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-end border-b bg-white px-6">
          <button
            onClick={() => void handleLogout()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            로그아웃
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
