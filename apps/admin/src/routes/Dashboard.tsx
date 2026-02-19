import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/auth';

export function Dashboard() {
  const setSession = useAuthStore((s) => s.setSession);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <h1 className="text-xl font-bold">MADMEDSALES</h1>
        <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-gray-900">
          로그아웃
        </button>
      </header>
      <main className="p-6">
        <p className="text-gray-500">대시보드 — Phase 1에서 구현 예정</p>
      </main>
    </div>
  );
}
