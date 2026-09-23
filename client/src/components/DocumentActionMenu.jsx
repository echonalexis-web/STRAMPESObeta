import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { FaEllipsisH, FaEye, FaStar, FaDownload, FaTrashAlt } from "react-icons/fa";
import { filesAPI, isPrivateFileRef, resolveAssetUrl } from "../services/api";
import { useToast } from "./feedback/context";

/**
 * Kebab menu for a saved document card: Preview, Set as Primary, Download,
 * Delete. Resolves the (possibly private) storedValue to an openable URL
 * on demand, same mechanism as SecureFileLink, so both Preview and Download
 * work for Cloudinary-private refs and legacy local/public paths alike.
 */
export default function DocumentActionMenu({
  storedValue,
  title = "document",
  isPrimary = false,
  onSetPrimary,
  onDelete,
  disabled = false,
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const resolveUrl = async () => {
    if (!isPrivateFileRef(storedValue)) return resolveAssetUrl(storedValue);
    const { data } = await filesAPI.getSignedUrl(storedValue);
    return data?.url || "";
  };

  const withResolvedUrl = async (handler) => {
    setResolving(true);
    try {
      const url = await resolveUrl();
      if (!url) {
        toast.error("This file is unavailable right now.");
        return;
      }
      handler(url);
    } catch {
      toast.error("Failed to open this file.");
    } finally {
      setResolving(false);
      setOpen(false);
    }
  };

  const handlePreview = () =>
    withResolvedUrl((url) => window.open(url, "_blank", "noopener,noreferrer"));

  const handleDownload = () =>
    withResolvedUrl((url) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = title || "document";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });

  return (
    <div className="doc-action-menu" ref={rootRef}>
      <div className="doc-action-menu-actions">
        <button
          type="button"
          className="doc-action-menu-delete"
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          disabled={disabled || resolving}
          aria-label={`Delete ${title}`}
        >
          <FaTrashAlt /> Delete
        </button>

        <button
          type="button"
          className="doc-action-menu-trigger"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${title}`}
          title={`Actions for ${title}`}
        >
          <FaEllipsisH />
        </button>
      </div>

      {open && (
        <div className="doc-action-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={handlePreview} disabled={resolving}>
            <FaEye /> Preview
          </button>
          {!isPrimary && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSetPrimary();
              }}
            >
              <FaStar /> Set as Primary
            </button>
          )}
          <button type="button" role="menuitem" onClick={handleDownload} disabled={resolving}>
            <FaDownload /> Download
          </button>
        </div>
      )}
    </div>
  );
}

DocumentActionMenu.propTypes = {
  storedValue: PropTypes.string.isRequired,
  title: PropTypes.string,
  isPrimary: PropTypes.bool,
  onSetPrimary: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
