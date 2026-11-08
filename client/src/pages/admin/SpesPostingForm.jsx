import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resolveAssetUrl, spesAPI } from "../../services/api";
import StateBlock from "../../components/StateBlock";
import { useToast } from "../../components/feedback/context";
import { translateErrorCode } from "../../utils/apiErrors";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

// The three always-required documents are checkboxes; the academic proof and the OSY
// certificate are alternatives (a student gives one, an out-of-school youth the other),
// so one checkbox controls both of them.
const FIXED_DOCS = ["form2", "proof_of_age", "proof_of_financial_status"];
const ACADEMIC_PAIR = ["proof_of_academic_standing", "osy_certification"];
const STANDARD = [...FIXED_DOCS, ...ACADEMIC_PAIR];

// Cover image: optional, public, images only. Mirrors the server limits (3 MB).
const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COVER_MAX_BYTES = 3 * 1024 * 1024;

const toLocalInput = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EMPTY = {
  title: "",
  description: "",
  opensAt: "",
  applicationDeadline: "",
  slots: "",
  docs: { form2: true, proof_of_age: true, proof_of_financial_status: true, academic: true },
  requirements: "",
  resultsSummary: "",
  resultsUrl: "",
  publishAcceptedList: false,
  exposeScores: false,
  guardianRequired: "inherit",
  alsoPostToNews: true,
};

const fromPosting = (p) => {
  const slots = p.requiredSlots?.length ? p.requiredSlots : STANDARD;
  return {
    ...EMPTY,
    title: p.title || "",
    description: p.description || "",
    opensAt: toLocalInput(p.opensAt),
    applicationDeadline: toLocalInput(p.applicationDeadline),
    slots: p.slots ?? "",
    docs: {
      form2: slots.includes("form2"),
      proof_of_age: slots.includes("proof_of_age"),
      proof_of_financial_status: slots.includes("proof_of_financial_status"),
      academic: ACADEMIC_PAIR.some((s) => slots.includes(s)),
    },
    requirements: (p.requirements || []).join("\n"),
    resultsSummary: p.results?.summary || "",
    resultsUrl: p.results?.url || "",
    publishAcceptedList: Boolean(p.results?.publishAcceptedList),
    exposeScores: Boolean(p.results?.exposeScores),
    guardianRequired: p.guardianRequired === true ? "yes" : p.guardianRequired === false ? "no" : "inherit",
  };
};

const toPayload = (f) => {
  const requiredSlots = [
    ...FIXED_DOCS.filter((s) => f.docs[s]),
    ...(f.docs.academic ? ACADEMIC_PAIR : []),
  ];
  return {
    title: f.title,
    description: f.description,
    opensAt: f.opensAt ? new Date(f.opensAt).toISOString() : null,
    applicationDeadline: f.applicationDeadline ? new Date(f.applicationDeadline).toISOString() : null,
    slots: f.slots === "" ? null : f.slots,
    // All four standard types selected = "use the standard set" (empty list).
    requiredSlots: requiredSlots.length === STANDARD.length ? [] : requiredSlots,
    requirements: f.requirements.split("\n").map((l) => l.trim()).filter(Boolean),
    results: {
      summary: f.resultsSummary,
      url: f.resultsUrl,
      publishAcceptedList: f.publishAcceptedList,
      exposeScores: f.exposeScores,
    },
    guardianRequired: f.guardianRequired === "yes" ? true : f.guardianRequired === "no" ? false : null,
  };
};

// Create or edit one SPES posting. A new posting can be saved as a draft or published
// straight away (with the "Also post to News Feed" choice); an existing draft can be
// published from here too. Published postings keep their results state untouched.
export default function SpesPostingForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState("draft");
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [existingCover, setExistingCover] = useState("");
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [removeCover, setRemoveCover] = useState(false);
  const [coverError, setCoverError] = useState("");
  const coverInputRef = useRef(null);

  useEffect(() => {
    if (!isEdit) return undefined;
    let active = true;
    (async () => {
      try {
        const { data } = await spesAPI.adminGetPosting(id);
        if (!active) return;
        setForm(fromPosting(data.posting));
        setStatus(data.posting.status);
        setLegacy(Boolean(data.posting.legacy));
        setExistingCover(data.posting.coverImage || "");
      } catch (err) {
        if (active) setLoadError(translateErrorCode(err?.response?.data?.code, t("spesPostings.admin.loadFailed")));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, isEdit, t]);

  // A local preview of the chosen file, released when it changes or the form closes.
  useEffect(() => {
    if (!coverFile) {
      setCoverPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const pickCover = (file) => {
    if (!file) return;
    if (!COVER_TYPES.includes(file.type)) {
      setCoverError("SPES_COVER_TYPE");
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      setCoverError("SPES_COVER_TOO_LARGE");
      return;
    }
    setCoverError("");
    setRemoveCover(false);
    setCoverFile(file);
  };

  const clearCover = () => {
    setCoverFile(null);
    setCoverError("");
    if (coverInputRef.current) coverInputRef.current.value = "";
  };

  const set = (name, value) => {
    setErrorCode("");
    setForm((prev) => ({ ...prev, [name]: value }));
  };
  const setDoc = (name, value) => {
    setErrorCode("");
    setForm((prev) => ({ ...prev, docs: { ...prev.docs, [name]: value } }));
  };

  // Creating with a cover: the posting is created as a draft first (the cover needs its id),
  // the image is uploaded, and only then published, so the news card gets the image.
  const save = async (intent) => {
    if (!form.title.trim()) {
      setErrorCode("SPES_TITLE_REQUIRED");
      return;
    }
    setSaving(intent);
    setErrorCode("");
    let postingId = id;
    try {
      const payload = toPayload(form);
      const publishNow = intent === "publish";
      if (isEdit) {
        await spesAPI.adminUpdatePosting(id, payload);
      } else {
        const { data } = await spesAPI.adminCreatePosting({
          ...payload,
          status: publishNow && !coverFile ? "published" : "draft",
          alsoPostToNews: form.alsoPostToNews,
        });
        postingId = data.posting._id;
      }

      if (coverFile) {
        await spesAPI.adminUploadCover(postingId, coverFile);
      } else if (isEdit && removeCover && existingCover) {
        await spesAPI.adminRemoveCover(postingId);
      }

      if (publishNow && (isEdit || coverFile)) {
        await spesAPI.adminSetPostingStatus(postingId, "published", form.alsoPostToNews);
      }
      toast.success(t(publishNow ? "spesPostings.admin.published" : isEdit ? "spesPostings.form.saved" : "spesPostings.form.created"));
      navigate("/admin/spes/postings");
    } catch (err) {
      const code = err?.response?.data?.code || "GENERIC";
      setErrorCode(code);
      toast.error(translateErrorCode(code, err?.response?.data?.message || t("spes.admin.saveFailed")));
      // The draft exists but its cover or publishing step failed: carry on editing it.
      if (!isEdit && postingId && postingId !== id) navigate(`/admin/spes/postings/${postingId}/edit`, { replace: true });
    } finally {
      setSaving("");
    }
  };

  if (loading) {
    return (
      <div className="admin-page-container spes-admin">
        <StateBlock kind="loading" title={t("admin.spes.loading")} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="admin-page-container spes-admin">
        <StateBlock
          kind="error"
          title={t("spesPostings.admin.loadFailed")}
          description={loadError}
          action={<Link to="/admin/spes/postings" className="spes-btn spes-btn--small">{t("spesPostings.form.back")}</Link>}
        />
      </div>
    );
  }
  if (legacy) {
    return (
      <div className="admin-page-container spes-admin">
        <StateBlock
          kind="empty"
          title={t("spesPostings.form.legacyTitle")}
          description={t("spesPostings.admin.legacyNote")}
          action={<Link to="/admin/news" className="spes-btn spes-btn--small">{t("navbar.newsManagement")}</Link>}
        />
      </div>
    );
  }

  const published = status === "published";
  const err = errorCode ? translateErrorCode(errorCode, t("spes.admin.saveFailed")) : "";

  return (
    <div className="admin-page-container spes-admin">
      <AdminHeader
        title={isEdit ? t("spesPostings.form.editTitle") : t("spesPostings.form.newTitle")}
        description={t("spesPostings.adminDescription")}
      />

      <form
        className="spes-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(published || isEdit ? "save" : "draft");
        }}
        noValidate
      >
        <fieldset className="spes-form__section">
          <legend>{t("spesPostings.form.basics")}</legend>
          <label>
            {t("spesPostings.form.title")} <span aria-hidden="true">*</span>
            <input type="text" value={form.title} maxLength={180} required aria-invalid={errorCode === "SPES_TITLE_REQUIRED"} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label>
            {t("spesPostings.form.description")}
            <textarea rows={5} maxLength={8000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>
        </fieldset>

        <fieldset className="spes-form__section">
          <legend>{t("spesPostings.form.cover")}</legend>
          {coverPreview || (existingCover && !removeCover) ? (
            <img
              className="spes-form__cover"
              src={coverPreview || resolveAssetUrl(existingCover)}
              alt={t("spesPostings.form.coverPreviewAlt")}
            />
          ) : null}
          <label>
            {t("spesPostings.form.coverChoose")}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby="spes-cover-hint"
              onChange={(e) => pickCover(e.target.files?.[0])}
            />
          </label>
          <p id="spes-cover-hint" className="spes-note">{t("spesPostings.form.coverHint")}</p>
          {coverError ? <p className="spes-apply__error" role="alert">{translateErrorCode(coverError, t("spes.admin.saveFailed"))}</p> : null}
          <div className="spes-form__cover-actions">
            {coverFile ? (
              <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={clearCover}>
                {t("spesPostings.form.coverClear")}
              </button>
            ) : null}
            {isEdit && existingCover && !coverFile ? (
              <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" aria-pressed={removeCover} onClick={() => setRemoveCover((v) => !v)}>
                {removeCover ? t("spesPostings.form.coverKeep") : t("spesPostings.form.coverRemove")}
              </button>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="spes-form__section">
          <legend>{t("spesPostings.form.period")}</legend>
          <div className="spes-form__row">
            <label>
              {t("spesPostings.form.opensAt")}
              <input type="datetime-local" value={form.opensAt} onChange={(e) => set("opensAt", e.target.value)} />
            </label>
            <label>
              {t("spesPostings.form.deadline")}
              <input type="datetime-local" value={form.applicationDeadline} onChange={(e) => set("applicationDeadline", e.target.value)} />
            </label>
            <label>
              {t("spesPostings.form.slots")}
              <input type="number" min="0" step="1" inputMode="numeric" value={form.slots} onChange={(e) => set("slots", e.target.value)} />
            </label>
          </div>
          <p className="spes-note">{t("spesPostings.form.periodHint")}</p>
        </fieldset>

        <fieldset className="spes-form__section">
          <legend>{t("spesPostings.form.documents")}</legend>
          {FIXED_DOCS.map((slot) => (
            <label key={slot} className="spes-form__check">
              <input type="checkbox" checked={form.docs[slot]} onChange={(e) => setDoc(slot, e.target.checked)} />
              <span>{t(`spes.docs.slot.${slot}`)}</span>
            </label>
          ))}
          <label className="spes-form__check">
            <input type="checkbox" checked={form.docs.academic} onChange={(e) => setDoc("academic", e.target.checked)} />
            <span>{t("spesPostings.form.academicOrOsy")}</span>
          </label>
          <label>
            {t("spesPostings.form.requirements")}
            <textarea rows={3} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder={t("spesPostings.form.requirementsHint")} />
          </label>
        </fieldset>

        <fieldset className="spes-form__section">
          <legend>{t("spesPostings.form.guardian")}</legend>
          <label>
            {t("spesPostings.form.guardianLabel")}
            <select value={form.guardianRequired} onChange={(e) => set("guardianRequired", e.target.value)}>
              <option value="inherit">{t("spesPostings.form.guardianInherit")}</option>
              <option value="yes">{t("spesPostings.form.guardianYes")}</option>
              <option value="no">{t("spesPostings.form.guardianNo")}</option>
            </select>
          </label>
          <p className="spes-note">{t("spesPostings.form.guardianHint")}</p>
        </fieldset>

        <fieldset className="spes-form__section">
          <legend>{t("spesPostings.form.results")}</legend>
          <label>
            {t("spesPostings.form.resultsSummary")}
            <textarea rows={3} value={form.resultsSummary} onChange={(e) => set("resultsSummary", e.target.value)} />
          </label>
          <label>
            {t("spesPostings.form.resultsUrl")}
            <input type="url" value={form.resultsUrl} onChange={(e) => set("resultsUrl", e.target.value)} />
          </label>
          <label className="spes-form__check">
            <input type="checkbox" checked={form.publishAcceptedList} onChange={(e) => set("publishAcceptedList", e.target.checked)} />
            <span>{t("spesPostings.form.publishList")}</span>
          </label>
          <label className="spes-form__check">
            <input type="checkbox" checked={form.exposeScores} onChange={(e) => set("exposeScores", e.target.checked)} />
            <span>{t("spesPostings.form.exposeScores")}</span>
          </label>
        </fieldset>

        {!published ? (
          <fieldset className="spes-form__section">
            <legend>{t("spesPostings.form.visibility")}</legend>
            <label className="spes-form__check">
              <input type="checkbox" checked={form.alsoPostToNews} onChange={(e) => set("alsoPostToNews", e.target.checked)} />
              <span>{t("spesPostings.form.alsoNews")}</span>
            </label>
            <p className="spes-note">{t("spesPostings.form.alsoNewsHint")}</p>
          </fieldset>
        ) : null}

        {err ? <p className="spes-drawer__error" role="alert">{err}</p> : null}

        <div className="spes-form__actions">
          <Link to="/admin/spes/postings" className="spes-btn spes-btn--ghost">
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Link>
          {published || isEdit ? (
            <button type="submit" className="spes-btn" disabled={Boolean(saving)}>
              {saving === "save" ? t("spes.admin.saving") : t("spesPostings.form.saveChanges")}
            </button>
          ) : (
            <button type="submit" className="spes-btn spes-btn--ghost" disabled={Boolean(saving)}>
              {saving === "draft" ? t("spes.admin.saving") : t("spesPostings.form.saveDraft")}
            </button>
          )}
          {!published ? (
            <button type="button" className="spes-btn" disabled={Boolean(saving)} onClick={() => save("publish")}>
              {saving === "publish" ? t("spes.admin.saving") : t("spesPostings.admin.publish")}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
