import { useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

const routeNeedsCompletedOnboarding = (role, pathname) => {
  if (role === "jobseeker") {
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

  if (loading) {
    return null; // Or a spinner/loading indicator
  }

  if (!token || !user) {
    return <Navigate to="/login" />;
  }

  // A superadmin-provisioned admin must set their own password before doing
  // anything else. The change-password screen itself is exempt.
  if (user?.mustChangePassword === true && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  const hasCompletedOnboarding =
    typeof user?.hasCompletedOnboarding === "boolean"
      ? user.hasCompletedOnboarding
      : user?.onboardingComplete;

  const needsOnboarding = ["jobseeker", "employer"].includes(userRole) && hasCompletedOnboarding === false;

  // Intentionally no "already onboarded, redirect away from /onboarding" check
  // here: JobSeekerOnboarding/EmployerOnboarding both already redirect away on
  // mount when the user is already onboarded, guarded by their own local
  // `finished` flag. A duplicate check here would fire the instant `login()`
  // flips `hasCompletedOnboarding` to true right after a successful
  // submission — before this component's own `finished`-guarded effect gets
  // a chance to show its success step — racing the user away from it.

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

  // Superadmin access to admin pages is granted per-route in App.jsx (an
  // explicit ["admin", "superadmin"] list), not blanket-inherited — so the
  // superadmin only reaches the technical modules, not news / SPES.
  if (requiredRole && ![].concat(requiredRole).includes(userRole)) {
    return <Navigate to="/" />;
  }

  return children;
};
