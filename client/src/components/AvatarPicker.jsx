import { useEffect, useRef, useState } from "react";
import { FaCamera, FaSpinner } from "react-icons/fa";
import { authAPI, resolveAssetUrl } from "../services/api";
import { useToast } from "./feedback/context";
import ImageEditorModal from "./ImageEditorModal";
import "../styles/avatar-picker.css";

const MAX_SIZE = 5 * 1024 * 1024; // pre-crop guard; the cropped output is small
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

/**
 * Circular avatar picker. The chosen image goes through the crop/rotate editor,
 * then the cropped result is uploaded via PATCH /auth/profile/avatar and the
 * stored value is reported through onUploaded.
 */
export default function AvatarPicker({
  initialUrl = "",
  name = "",
  onUploaded,
  size = 128,
  disabled = false,
  inline = false,
  // Overrides the default authAPI.updateAvatar(file) call — used where the
  // upload must go through an id-scoped endpoint instead (e.g. employer
  // onboarding posting to POST /employers/:id/avatar).
  uploadFn,
}) {
  const toast = useToast();
  const inputRef = useRef(null);
  const previewUrlRef = useRef("");
  const editorUrlRef = useRef("");
  const [preview, setPreview] = useState(initialUrl ? resolveAssetUrl(initialUrl) : "");
  const [editorSrc, setEditorSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
  }, []);

  const setLocalPreview = (file) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreview(url);
  };

  const resetPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
    setPreview(initialUrl ? resolveAssetUrl(initialUrl) : "");
  };

  const closeEditor = () => {
    if (editorUrlRef.current) {
      URL.revokeObjectURL(editorUrlRef.current);
      editorUrlRef.current = "";
    }
    setEditorSrc("");
  };

  const handlePick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Image must be 5MB or smaller.");
      return;
    }

    setError("");
    if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
    const url = URL.createObjectURL(file);
    editorUrlRef.current = url;
    setEditorSrc(url);
  };

  const handleCropped = async (file) => {
    closeEditor();
    setLocalPreview(file);
    setBusy(true);
    setError("");
    try {
      const doUpload = uploadFn || authAPI.updateAvatar;
      const { data } = await doUpload(file);
      onUploaded?.(data.profileImage || data.avatarUrl);
      toast.success("Profile photo updated.");
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed. Please try again.");
      toast.error(err.response?.data?.message || "Photo upload failed. Please try again.");
      resetPreview();
    } finally {
      setBusy(false);
    }
  };

  const initial = (name.trim().charAt(0) || "U").toUpperCase();

  return (
    <div className={`avatar-picker${inline ? " avatar-picker--inline" : ""}`}>
      <button
        type="button"
        className="avatar-picker-circle"
        style={{ width: size, height: size }}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        aria-label={preview ? "Change profile photo" : "Add a profile photo"}
      >
        {preview ? (
          <img src={preview} alt="" className="avatar-picker-image" />
        ) : (
          <span className="avatar-picker-initial">{initial}</span>
        )}
        <span className="avatar-picker-overlay">
          {busy ? <FaSpinner className="avatar-picker-spin" aria-hidden="true" /> : <FaCamera aria-hidden="true" />}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="avatar-picker-input"
        hidden
        onChange={handlePick}
      />
      <div className="avatar-picker-meta">
        <p className="avatar-picker-hint">{busy ? "Uploading…" : "JPG, PNG, or WEBP · up to 5MB"}</p>
        {error ? <p className="avatar-picker-error">{error}</p> : null}
      </div>

      <ImageEditorModal
        open={Boolean(editorSrc)}
        src={editorSrc}
        cropShape="round"
        title="Adjust your photo"
        fileName="avatar.jpg"
        onCancel={closeEditor}
        onConfirm={handleCropped}
      />
    </div>
  );
}
