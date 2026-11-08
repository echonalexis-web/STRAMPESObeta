import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { canViewJobs } from "../utils/age";

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];

// Keeps a logged-in jobseeker with no usable date of birth (or under 15) off the
// job board. 15-17 accounts MAY browse jobs; they just can't apply (the job
// pages swap Apply for a notice, and the server blocks the apply call). A no-op
// for guests and every other role, so it's safe to wrap around routes like
// /jobs/:id that are otherwise publicly viewable. Display only: the server
// re-checks the age on every request.
export const JobVacancyAgeGate = ({ children }) => {
  const { user } = useContext(AuthContext);
  if (user && JOBSEEKER_ROLES.includes(user.role) && !canViewJobs(user.dateOfBirth)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};
