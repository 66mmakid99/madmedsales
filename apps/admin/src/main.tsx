import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { supabase } from './lib/supabase';
import { useAuthStore } from './stores/auth';
import './styles/global.css';

const { setSession } = useAuthStore.getState();

// 1. 세션 복원 (localStorage → Zustand)
supabase.auth.getSession().then(({ data: { session } }) => {
  setSession(session);
});

// 2. 세션 변경 감지 (로그인/로그아웃/토큰 갱신)
supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
