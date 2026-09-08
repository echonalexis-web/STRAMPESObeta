import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import JobSeekerOnboarding from "./onboarding/JobSeekerOnboarding";
import EmployerOnboarding from "./onboarding/EmployerOnboarding";
import "../styles/onboarding.css";

export default function Onboarding() {
  const { user } = useContext(AuthContext);
  const isEmployer = user?.role === "employer";

  return isEmployer ? <EmployerOnboarding /> : <JobSeekerOnboarding />;
}
