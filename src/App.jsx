import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { HomeRedirect, PublicOnly, RequireAuth } from './routes/guards';
import ProjectRoute from './routes/ProjectRoute';
import AuthPage from './pages/auth/AuthPage';
import AuthCallbackPage from './pages/auth/AuthCallbackPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import OnboardingPage from './pages/auth/OnboardingPage';
import ProjectsHome from './pages/projects/ProjectsHome';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<PublicOnly><AuthPage key="login" initialMode="login" /></PublicOnly>} />
          <Route path="/signup" element={<PublicOnly><AuthPage key="signup" initialMode="signup" /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><AuthPage key="forgot" initialMode="forgot" /></PublicOnly>} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/projects/:projectId/owner/*" element={<RequireAuth><ProjectRoute /></RequireAuth>} />
          <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route path="/projects" element={<RequireAuth><ProjectsHome /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
