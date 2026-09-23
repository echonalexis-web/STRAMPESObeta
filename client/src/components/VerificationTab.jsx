import { useState } from "react";
import { FaCheckCircle, FaClock, FaTimesCircle, FaRegCircle } from "react-icons/fa";
import { employerAccountAPI } from "../services/api";
import { useToast } from "./feedback/context";
import FileDropzone from "./FileDropzone";

const STATUS_COPY = {
  unverified: {
    label: "Unverified",
    hint: "Upload both documents below, then submit them for admin review.",
  },
  pending: {
    label: "Pending verification",
    hint: "Your documents are under review by LMD Admin. You'll be notified and messaged with the result.",
  },
  verified: {
    label: "Verified",
    hint: "Your account is verified — you can post job vacancies.",
  },
  rejected: {
    label: "Rejected",
    hint: "Your last submission was not approved. Update your documents and submit again.",
  },
};

const ChecklistItem = ({ done, label }) => (
  <li className={`verify-checklist-item${done ? " is-done" : ""}`}>
    {done ? <FaCheckCircle aria-hidden="true" /> : <FaRegCircle aria-hidden="true" />}
    <span>{label}</span>
  </li>
);

/**
 * Employer-only "Verification" tab: upload areas for the business permit and
 * DTI/SEC registration document, a checklist of what's required, and the
 * submit action. Posts both files (or reuses whichever are already on file)
 * to POST /employers/:id/verification/submit in a single call.
 */
export default function VerificationTab({ user, onUpdated }) {
  const toast = useToast();
  const employerId = user?._id || user?.id;

  const [permitFile, setPermitFile] = useState(null);
  const [registrationFile, setRegistrationFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const status = user?.verificationStatus || "unverified";
  const copy = STATUS_COPY[status] || STATUS_COPY.unverified;

  const hasPermit = Boolean(permitFile || user?.businessPermitUrl);
  const hasRegistration = Boolean(registrationFile || user?.registrationDocUrl);
  const canEdit = status === "unverified" || status === "rejected";
  const canSubmit = canEdit && hasPermit && hasRegistration && !submitting;

  const handleSubmit = async () => {
    if (!employerId || !canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await employerAccountAPI.submitVerification(employerId, {
        businessPermit: permitFile,
        registrationDoc: registrationFile,
      });
      setPermitFile(null);
      setRegistrationFile(null);
      onUpdated?.({
        verificationStatus: data.verificationStatus,
        verificationNote: null,
        businessPermitUrl: data.businessPermitUrl,
        registrationDocUrl: data.registrationDocUrl,
      });
      toast.success("Your documents were submitted for review.");
    } catch (err) {
      const message = err.response?.data?.message || "Failed to submit verification documents.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="verify-tab">
      <div className={`verify-status-banner verify-status-banner--${status}`}>
        {status === "verified" ? <FaCheckCircle aria-hidden="true" /> : status === "pending" ? <FaClock aria-hidden="true" /> : <FaTimesCircle aria-hidden="true" />}
        <div>
          <strong>{copy.label}</strong>
          <p>{copy.hint}</p>
          {status === "rejected" && user?.verificationNote ? (
            <p className="verify-reject-note">Admin note: {user.verificationNote}</p>
          ) : null}
        </div>
      </div>

      <ul className="verify-checklist">
        <ChecklistItem done={hasPermit} label="Business Permit" />
        <ChecklistItem done={hasRegistration} label="DTI / SEC Registration Document" />
      </ul>

      <div className="verify-uploads">
        <FileDropzone
          id="verify-business-permit"
          label="Business Permit"
          hint="Accepted formats: PDF, DOC, JPG, PNG. Max 5 MB."
          file={permitFile}
          existingUrl={user?.businessPermitUrl}
          disabled={!canEdit}
          onFileSelect={setPermitFile}
          onRemove={() => setPermitFile(null)}
        />
        <FileDropzone
          id="verify-registration-doc"
          label="DTI / SEC Registration Document"
          hint="Accepted formats: PDF, DOC, JPG, PNG. Max 5 MB."
          file={registrationFile}
          existingUrl={user?.registrationDocUrl}
          disabled={!canEdit}
          onFileSelect={setRegistrationFile}
          onRemove={() => setRegistrationFile(null)}
        />
      </div>

      {error ? <p className="verify-error-text">{error}</p> : null}

      {canEdit ? (
        <button type="button" className="rd2-btn rd2-btn--primary" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "Submitting…" : "Submit for verification"}
        </button>
      ) : null}
    </div>
  );
}
