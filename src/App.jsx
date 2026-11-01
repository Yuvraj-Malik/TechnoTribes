import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PublicOnly, RequireAuth } from './routes/guards';
import AuthPage from './pages/auth/AuthPage';
import AuthCallbackPage from './pages/auth/AuthCallbackPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import OnboardingPage from './pages/auth/OnboardingPage';
import AppShell from './components/layout/AppShell';
import OverviewPage from './pages/dashboard/OverviewPage';
import MyProjectsPage from './pages/dashboard/MyProjectsPage';
import ExplorePage from './pages/dashboard/ExplorePage';
import RequestsPage from './pages/dashboard/RequestsPage';
import NotificationsPage from './pages/dashboard/NotificationsPage';
import ProjectPage from './pages/projects/ProjectPage';
import TeamLayout, { TeamHome } from './pages/projects/TeamLayout';
import DeveloperWorkspace from './pages/worker/DeveloperWorkspace';
import ManagerReview from './pages/admin/ManagerReview';
import ApprovalQueue from './pages/admin/ApprovalQueue';
import ProjectStory from './pages/projects/ProjectStory';
import TeamSetup from './pages/owner/TeamSetup';
import TasksPage from './pages/projects/TasksPage';
import ContextPage from './pages/projects/ContextPage';
import MembersPage from './pages/projects/MembersPage';
import SettingsPage from './pages/projects/SettingsPage';
import ObserverRequestsPage from './pages/projects/RequestsPage';
import MySubmissions from './pages/worker/MySubmissions';
import CodePage from './pages/projects/CodePage';
import MessagesPage from './pages/projects/MessagesPage';
import { ObserverSite, ObserverUpdates } from './pages/observer/ObserverPages';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Signed out */}
          <Route path="/login" element={<PublicOnly><AuthPage key="login" initialMode="login" /></PublicOnly>} />
          <Route path="/signup" element={<PublicOnly><AuthPage key="signup" initialMode="signup" /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><AuthPage key="forgot" initialMode="forgot" /></PublicOnly>} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Signed in */}
          <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route path="/dashboard" element={<OverviewPage />} />
            <Route path="/dashboard/projects" element={<MyProjectsPage />} />
            <Route path="/dashboard/explore" element={<ExplorePage />} />
            <Route path="/dashboard/requests" element={<RequestsPage />} />
            <Route path="/dashboard/notifications" element={<NotificationsPage />} />
            <Route path="/p/:projectId" element={<ProjectPage />} />

            {/* A project: asks for the project ID, then the team workspace */}
            <Route path="/projects/:projectId" element={<TeamLayout />}>
              <Route index element={<TeamHome />} />
              <Route path="workspace" element={<DeveloperWorkspace />} />
              <Route path="review" element={<ManagerReview />} />
              <Route path="approvals" element={<ApprovalQueue />} />
              <Route path="story" element={<ProjectStory />} />
              <Route path="setup" element={<TeamSetup />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="code" element={<CodePage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="context" element={<ContextPage />} />
              <Route path="team" element={<MembersPage />} />
              <Route path="members" element={<Navigate to="../team" replace />} />
              <Route path="requests" element={<ObserverRequestsPage />} />
              <Route path="submissions" element={<MySubmissions />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="site" element={<ObserverSite />} />
              <Route path="updates" element={<ObserverUpdates />} />
              <Route path="*" element={<Navigate to="." replace />} />
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/projects" element={<Navigate to="/dashboard/projects" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
