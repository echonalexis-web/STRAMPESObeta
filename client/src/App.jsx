import { useContext } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { AuthContext } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import About from "./pages/About";
import NewsFeed from "./pages/NewsFeed";
import NewsFeedDetail from "./pages/NewsFeedDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import JobBoard from "./pages/JobBoard";
import JobDetail from "./pages/JobDetail";
import ProfilePage from "./pages/ProfilePage";
import EditProfile from "./pages/EditProfile";
import Onboarding from "./pages/Onboarding";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Reports from "./pages/admin/Reports";
import NewsFeedManagement from "./pages/admin/NewsFeedManagement";
import CreateAnnouncement from "./pages/admin/CreateAnnouncement";
import UserManagement from "./pages/admin/UserManagement";
import UserProfileView from "./pages/admin/UserProfileView";
import AuditTrail from "./pages/admin/AuditTrail";
import JobMonitoring from "./pages/admin/JobMonitoring";
import EmployerDashboard from "./pages/EmployerDashboard";
import EmployeeRegister from "./pages/EmployeeRegister";
import PostJob from "./pages/PostJob";
import Messages from "./pages/Messages";
import Notifications from "./pages/Notifications";
import YourApplications from "./pages/YourApplications";

import "./styles/style.css";

function HomeRoute() {
  const { user } = useContext(AuthContext);
  const normalizedRole = user?.role === "employee" || user?.role === "jobseeker" ? "resident" : user?.role;

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
        <Navbar />
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/about" element={<About />} />
          <Route path="/news" element={<NewsFeed />} />
          <Route path="/news/:id" element={<NewsFeedDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register-employer" element={<EmployeeRegister />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/favorites" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/likes" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/followers" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute requiredRole="resident"><Dashboard /></ProtectedRoute>} />
          <Route path="/applications" element={<ProtectedRoute requiredRole="resident"><YourApplications /></ProtectedRoute>} />
          <Route path="/jobs" element={<ProtectedRoute requiredRole="resident"><JobBoard /></ProtectedRoute>} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/post-job" element={<ProtectedRoute requiredRole="employer"><PostJob /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/reports" element={<ProtectedRoute requiredRole="admin"><Reports /></ProtectedRoute>} />
          <Route path="/admin/news" element={<ProtectedRoute requiredRole="admin"><NewsFeedManagement /></ProtectedRoute>} />
          <Route path="/admin/news/create" element={<ProtectedRoute requiredRole="admin"><CreateAnnouncement /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requiredRole="admin"><UserManagement /></ProtectedRoute>} />
          <Route path="/admin/job-monitoring" element={<ProtectedRoute requiredRole="admin"><JobMonitoring /></ProtectedRoute>} />
          <Route path="/admin/audit-logs" element={<ProtectedRoute requiredRole="admin"><AuditTrail /></ProtectedRoute>} />
          <Route path="/admin/users/:userId" element={<ProtectedRoute requiredRole="admin"><UserProfileView /></ProtectedRoute>} />
          <Route path="/admin/users/:userId/*" element={<ProtectedRoute requiredRole="admin"><UserProfileView /></ProtectedRoute>} />
          <Route path="/employer" element={<ProtectedRoute requiredRole="employer"><EmployerDashboard /></ProtectedRoute>} />
          <Route path="/employer-dashboard" element={<ProtectedRoute requiredRole="employer"><EmployerDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;