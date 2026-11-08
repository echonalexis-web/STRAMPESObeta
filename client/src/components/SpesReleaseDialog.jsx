import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { spesAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import { useToast } from "./feedback/context";
import AppModal from "./AppModal";

// Release confirmation for one posting: shows exactly what will happen (how many
// applicants are told, how many are excluded, whether any result is still undecided)
// before it does. Release is per posting and cannot be undone, only amended.
export default function SpesReleaseDialog({ posting, onClose, onReleased }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await spesAPI.adminReleaseSummary(posting._id);
        if (active) setSummary(data);
      } catch (err) {
        toast.error(translateErrorCode(err?.response?.data?.code, t("spes.admin.saveFailed")));
        onClose();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posting._id]);

  const release = async () => {
    setReleasing(true);
    try {
      await spesAPI.adminReleaseResults(posting._id);
      toast.success(t("spes.admin.released"));
      onReleased(posting._id);
      onClose();
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, err?.response?.data?.message || t("spes.admin.saveFailed")));
    } finally {
      setReleasing(false);
    }
  };

  return (
    <AppModal
      isOpen
      onClose={onClose}
      title={t("spes.admin.releaseTitle", { title: posting.title })}
      closeLabel={t("common.close", { defaultValue: "Close" })}
    >
      {loading || !summary ? (
        <p className="spes-note">{t("admin.spes.loading")}</p>
      ) : (
        <div className="spes-release">
          <p className="spes-note">{t("spes.admin.releaseIntro", { count: summary.toNotify })}</p>
          <ul className="spes-release__list">
            <li>{t("spes.outcome.accepted")}: <strong>{summary.byOutcome.accepted}</strong></li>
            <li>{t("spes.outcome.waitlisted")}: <strong>{summary.byOutcome.waitlisted}</strong></li>
            <li>{t("spes.outcome.not_accepted")}: <strong>{summary.byOutcome.not_accepted}</strong></li>
            <li>{t("spes.admin.excludedCount")}: <strong>{summary.excluded}</strong></li>
          </ul>
          {summary.undecided > 0 ? (
            <p className="spes-drawer__error" role="alert">{t("spes.admin.undecidedBlock", { count: summary.undecided })}</p>
          ) : (
            <p className="spes-drawer__warning">{t("spes.admin.releaseWarning")}</p>
          )}
          <div className="spes-modal__actions">
            <button type="button" className="spes-btn spes-btn--ghost" onClick={onClose} disabled={releasing}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" className="spes-btn" disabled={!summary.canRelease || releasing} onClick={release}>
              {releasing ? t("spes.admin.releasing") : t("spes.admin.releaseConfirm")}
            </button>
          </div>
        </div>
      )}
    </AppModal>
  );
}
