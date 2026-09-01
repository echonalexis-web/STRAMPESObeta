import { useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

const routeNeedsCompletedOnboarding = (role, pathname) => {
  if (role === "resident") {
    return pathname !== "/onboarding";
  }

  if (role === "employer") {
    return pathname === "/employer-dashboard" || pathname === "/post-job";
  }

  return false;
};

export const ProtectedRoute = ({ children, requiredRole }) => {
  const { user, token, loading } = useContext(AuthContext);
  const location = useLocation();
  const userRole = normalizeRole(user?.role);

  const getDefaultRouteByRole = (role) => {
    if (role === "admin") return "/admin";
    if (role === "employer") return "/employer-dashboard";
    return "/dashboard";
  };

  if (loading) {
    return null; // Or a spinner/loading indicator
  }

  if (!token || !user) {
    return <Navigate to="/login" />;
  }

  const hasCompletedOnboarding =
    typeof user?.hasCompletedOnboarding === "boolean"
      ? user.hasCompletedOnboarding
      : user?.onboardingComplete;

  const needsOnboarding = ["resident", "employer"].includes(userRole) && hasCompletedOnboarding === false;

  if (location.pathname === "/onboarding" && hasCompletedOnboarding === true) {
    return <Navigate to={getDefaultRouteByRole(userRole)} replace />;
  }

  if (
    needsOnboarding &&
    location.pathname !== "/onboarding" &&
    routeNeedsCompletedOnboarding(userRole, location.pathname)
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  const isVerifiedEmployer = userRole === "employer" && user?.verificationStatus === "verified";
  if (userRole === "employer" && !isVerifiedEmployer && location.pathname === "/post-job") {
    return <Navigate to="/employer-dashboard" replace />;
  }

  if (requiredRole && ![].concat(requiredRole).includes(userRole)) {
    return <Navigate to="/" />;
  }

  return children;
};
