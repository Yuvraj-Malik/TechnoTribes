import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { HomeRedirect, PublicOnly, RequireAuth } from './routes/guards';
import AuthPage from './pages/auth/AuthPage';
import AuthCallbackPage from './pages/auth/AuthCallbackPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import OnboardingPage from './pages/auth/OnboardingPage';
import ProjectsHome from './pages/projects/ProjectsHome';
import TeamLayout, { TeamHome } from './pages/projects/TeamLayout';
import DeveloperWorkspace from './pages/worker/DeveloperWorkspace';
import ManagerReview from './pages/admin/ManagerReview';
import ProjectStory from './pages/projects/ProjectStory';
import TeamSetup from './pages/owner/TeamSetup';

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
          <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route path="/projects" element={<RequireAuth><ProjectsHome /></RequireAuth>} />
          <Route path="/projects/:projectId" element={<RequireAuth><TeamLayout /></RequireAuth>}>
            <Route index element={<TeamHome />} />
            <Route path="workspace" element={<DeveloperWorkspace />} />
            <Route path="review" element={<ManagerReview />} />
            <Route path="story" element={<ProjectStory />} />
            <Route path="setup" element={<TeamSetup />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
