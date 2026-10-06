import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { isJobVacancyEligibleAge } from "../utils/age";

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// Blocks a logged-in 15-17 (or unknown-DOB) jobseeker from job vacancy
// surfaces. A no-op for guests and every other role, so it's safe to wrap
// around routes like /jobs/:id that are otherwise publicly viewable.
export const JobVacancyAgeGate = ({ children }) => {
  const { user } = useContext(AuthContext);
  if (user && JOBSEEKER_ROLES.includes(user.role) && !isJobVacancyEligibleAge(user.dateOfBirth)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};
