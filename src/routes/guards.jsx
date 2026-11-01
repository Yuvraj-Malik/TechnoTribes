// Route guards: who may see which screen.
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Loading() {
  return <div className="grid min-h-screen place-items-center text-dim" role="status">Loading…</div>;
}

// Signed-in users only.
export function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// Signed-out users only (login, signup, forgot password).
export function PublicOnly({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (session) return <Navigate to="/dashboard" replace />;
  return children;
}
