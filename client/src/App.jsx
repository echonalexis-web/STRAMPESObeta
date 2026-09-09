import { useContext } from "react";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { AuthContext } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { FeedbackProvider } from "./components/feedback/FeedbackProvider";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import About from "./pages/About";
import NewsFeed from "./pages/NewsFeed";
import NewsFeedDetail from "./pages/NewsFeedDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ChangePassword from "./pages/ChangePassword";
import SuperadminConsole from "./pages/superadmin/SuperadminConsole";
import VerifyEmail from "./pages/VerifyEmail";
import AccountSuspended from "./pages/AccountSuspended";
import TermsGate from "./components/TermsGate";
import Dashboard from "./pages/Dashboard";
import JobBoard from "./pages/JobBoard";
import JobDetail from "./pages/JobDetail";
import ProfilePage from "./pages/ProfilePage";
import EditProfile from "./pages/EditProfile";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Reports from "./pages/admin/Reports";
import NewsFeedManagement from "./pages/admin/NewsFeedManagement";
import CreateAnnouncement from "./pages/admin/CreateAnnouncement";
import UserManagement from "./pages/admin/UserManagement";
import UserModeration from "./pages/admin/UserModeration";
import UserProfileView from "./pages/admin/UserProfileView";
import EmployerVerification from "./pages/admin/EmployerVerification";
import AuditTrail from "./pages/admin/AuditTrail";
import JobMonitoring from "./pages/admin/JobMonitoring";
import EmployerDashboard from "./pages/EmployerDashboard";
import EmployeeRegister from "./pages/EmployeeRegister";
import PostJob from "./pages/PostJob";
import Messages from "./pages/Messages";
import Notifications from "./pages/Notifications";
import YourApplications from "./pages/YourApplications";
import MySpesApplications from "./pages/MySpesApplications";
import SpesApplications from "./pages/admin/SpesApplications";

import "./styles/style.css";

// Routes that render standalone, without the marketing/app navbar. The
// account-suspended wall lands here precisely because the user can't sign in
// normally, so Login/Register chrome would be contradictory — and the fixed
// navbar overlaps the centered card.
const BARE_ROUTES = new Set(["/account-suspended", "/change-password"]);

function SiteChrome() {
  const { pathname } = useLocation();
  if (BARE_ROUTES.has(pathname)) return null;
  return <Navbar />;
}

function HomeRoute() {
  const { user } = useContext(AuthContext);
  const normalizedRole = user?.role === "employee" || user?.role === "jobseeker" ? "resident" : user?.role;

  if (normalizedRole === "superadmin") {
    return <Navigate to="/superadmin" replace />;
  }

  if (normalizedRole === "admin") {
    return <Navigate to="/admin" replace />;
  }

  return <Home />;
}

function AppRoutes() {
  const { user } = useContext(AuthContext);
  const userId = user?._id || user?.id;

  return (
    <SocketProvider userId={userId}>
      <BrowserRouter>
        <SiteChrome />
        <TermsGate />
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/about" element={<About />} />
          <Route path="/news" element={<NewsFeed />} />
          <Route path="/news/:id" element={<NewsFeedDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/account-suspended" element={<AccountSuspended />} />
          <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
          <Route path="/superadmin" element={<ProtectedRoute requiredRole="superadmin"><SuperadminConsole /></ProtectedRoute>} />
          <Route path="/register-employer" element={<EmployeeRegister />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/favorites" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/likes" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/followers" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute requiredRole="resident"><Dashboard /></ProtectedRoute>} />
          <Route path="/applications" element={<ProtectedRoute requiredRole="resident"><YourApplications /></ProtectedRoute>} />
          <Route path="/spes/applications" element={<ProtectedRoute><MySpesApplications /></ProtectedRoute>} />
          <Route path="/jobs" element={<ProtectedRoute requiredRole="resident"><JobBoard /></ProtectedRoute>} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/jobs/:id/apply" element={<JobDetail />} />
          <Route path="/post-job" element={<ProtectedRoute requiredRole="employer"><PostJob /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole={["admin", "superadmin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/reports" element={<ProtectedRoute requiredRole={["admin", "superadmin"]}><Reports /></ProtectedRoute>} />
          <Route path="/admin/news" element={<ProtectedRoute requiredRole="admin"><NewsFeedManagement /></ProtectedRoute>} />
          <Route path="/admin/news/create" element={<ProtectedRoute requiredRole="admin"><CreateAnnouncement /></ProtectedRoute>} />
          <Route path="/admin/news/edit/:id" element={<ProtectedRoute requiredRole="admin"><CreateAnnouncement /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requiredRole="superadmin"><UserManagement /></ProtectedRoute>} />
          <Route path="/admin/users/moderation" element={<ProtectedRoute requiredRole="superadmin"><UserModeration /></ProtectedRoute>} />
          <Route path="/admin/verification" element={<ProtectedRoute requiredRole={["admin", "superadmin"]}><EmployerVerification /></ProtectedRoute>} />
          <Route path="/admin/job-monitoring" element={<ProtectedRoute requiredRole={["admin", "superadmin"]}><JobMonitoring /></ProtectedRoute>} />
          <Route path="/admin/spes" element={<ProtectedRoute requiredRole="admin"><SpesApplications /></ProtectedRoute>} />
          <Route path="/admin/audit-logs" element={<ProtectedRoute requiredRole="superadmin"><AuditTrail /></ProtectedRoute>} />
          <Route path="/admin/users/:userId" element={<ProtectedRoute requiredRole={["admin", "superadmin"]}><UserProfileView /></ProtectedRoute>} />
          <Route path="/admin/users/:userId/*" element={<ProtectedRoute requiredRole={["admin", "superadmin"]}><UserProfileView /></ProtectedRoute>} />
          <Route path="/employer" element={<ProtectedRoute requiredRole="employer"><EmployerDashboard /></ProtectedRoute>} />
          <Route path="/employer-dashboard" element={<ProtectedRoute requiredRole="employer"><EmployerDashboard /></ProtectedRoute>} />
          <Route path="/employer/applicants/:userId" element={<ProtectedRoute requiredRole="employer"><ProfilePage isEmployerView /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <FeedbackProvider>
        <AppRoutes />
      </FeedbackProvider>
    </AuthProvider>
  );
}

export default App;