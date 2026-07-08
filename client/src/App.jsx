import { useContext } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { AuthContext } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import JobBoard from "./pages/JobBoard";
import JobDetail from "./pages/JobDetail";
import Profile from "./pages/Profile";
import EditProfile from "./pages/EditProfile";
import Onboarding from "./pages/Onboarding";
import AdminDashboard from "./pages/AdminDashboard";
import EmployerDashboard from "./pages/EmployerDashboard";
import EmployeeRegister from "./pages/EmployeeRegister";
import PostJob from "./pages/PostJob";
import Messages from "./pages/Messages";

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
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register-employer" element={<EmployeeRegister />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute requiredRole="resident"><Dashboard /></ProtectedRoute>} />
          <Route path="/jobs" element={<ProtectedRoute requiredRole="resident"><JobBoard /></ProtectedRoute>} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/post-job" element={<ProtectedRoute requiredRole="employer"><PostJob /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/employer" element={<ProtectedRoute requiredRole="employer"><EmployerDashboard /></ProtectedRoute>} />
          <Route path="/employer-dashboard" element={<ProtectedRoute requiredRole="employer"><EmployerDashboard /></ProtectedRoute>} />
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