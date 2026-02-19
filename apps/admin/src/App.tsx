import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { Login } from './routes/Login';
import { useAuthStore } from './stores/auth';

export function App() {
  const session = useAuthStore((s) => s.session);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
        <Route path="/*" element={session ? <Dashboard /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}
