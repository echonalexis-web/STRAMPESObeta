import { cloneElement, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resolveAssetUrl, spesAPI } from "../../services/api";
import StateBlock from "../../components/StateBlock";
import { useToast } from "../../components/feedback/context";
import { translateErrorCode } from "../../utils/apiErrors";
import { SPES_COVER_LIMITS, bytesToMb, uploadErrorCode } from "../../utils/spesUploadLimits";
import FileUpload from "../../components/FileUpload";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

// The three always-required documents are checkboxes; the academic proof and the OSY
// certificate are alternatives (a student gives one, an out-of-school youth the other),
// so one checkbox controls both of them.
const FIXED_DOCS = ["form2", "proof_of_age", "proof_of_financial_status"];
const ACADEMIC_PAIR = ["proof_of_academic_standing", "osy_certification"];
const STANDARD = [...FIXED_DOCS, ...ACADEMIC_PAIR];

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

// Layout pieces only; they add no behavior. A section is a fieldset with a legend (so
// screen readers announce the group), a field stacks label, control, hint and error, and
// a check row makes the whole row clickable.
function Section({ title, hint, children }) {
  return (
    <fieldset className="spes-form__card">
      <legend>{title}</legend>
      {hint ? <p className="spes-form__card-hint">{hint}</p> : null}
      <div className="spes-form__body">{children}</div>
    </fieldset>
  );
}

function Field({ id, label, required, hint, error, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="spes-field">
      <label className="spes-field__label" htmlFor={id}>
        {label}
        {required ? <span className="spes-field__req" aria-hidden="true">*</span> : null}
      </label>
      {cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? <p id={hintId} className="spes-field__hint">{hint}</p> : null}
      {error ? <p id={errId} className="spes-field__error" role="alert">{error}</p> : null}
    </div>
  );
}

function CheckRow({ id, checked, onChange, label, hint }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <label className="spes-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hintId} />
      <span className="spes-check__text">
        <span className="spes-check__label">{label}</span>
        {hint ? <span id={hintId} className="spes-check__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

// Server codes that belong to one field are shown under it; the rest go in the action bar.
const FIELD_OF_CODE = {
  SPES_TITLE_REQUIRED: "title",
  SPES_DATE_INVALID: "deadline",
  SPES_PERIOD_INVALID: "deadline",
  SPES_DEADLINE_IN_PAST: "deadline",
  SPES_SLOTS_INVALID: "slots",
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
  const [removeCover, setRemoveCover] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverProgress, setCoverProgress] = useState(0);
  const coverAbortRef = useRef(null);

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

  // Leaving the form cancels a cover upload that is still running.
  useEffect(() => () => coverAbortRef.current?.abort(), []);

  // FileUpload has already checked type and size. Removing the cover means "no cover on
  // save": a chosen file is dropped and a stored one is deleted when the form is saved.
  const pickCover = (file) => {
    setCoverError("");
    setRemoveCover(false);
    setCoverFile(file);
  };

  const clearCover = () => {
    setCoverFile(null);
    setCoverError("");
    if (existingCover) setRemoveCover(true);
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
    setCoverError("");
    let postingId = id;
    let stage = "";
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
        stage = "cover";
        const controller = new AbortController();
        coverAbortRef.current = controller;
        setCoverProgress(0);
        setCoverUploading(true);
        await spesAPI.adminUploadCover(postingId, coverFile, {
          signal: controller.signal,
          onUploadProgress: (event) => {
            if (event.total) setCoverProgress(Math.round((event.loaded / event.total) * 100));
          },
        });
        stage = "";
      } else if (isEdit && removeCover && existingCover) {
        await spesAPI.adminRemoveCover(postingId);
      }

      if (publishNow && (isEdit || coverFile)) {
        await spesAPI.adminSetPostingStatus(postingId, "published", form.alsoPostToNews);
      }
      toast.success(t(publishNow ? "spesPostings.admin.published" : isEdit ? "spesPostings.form.saved" : "spesPostings.form.created"));
      navigate("/admin/spes/postings");
    } catch (err) {
      const code = stage === "cover" ? uploadErrorCode(err) : err?.response?.data?.code || "GENERIC";
      if (stage === "cover") {
        // The posting is saved as a draft; only the image failed. Show it on the image.
        setCoverError(code);
      } else {
        setErrorCode(code);
      }
      toast.error(translateErrorCode(code, err?.response?.data?.message || t("spes.admin.saveFailed")));
      // The draft exists but its cover or publishing step failed: carry on editing it.
      if (!isEdit && postingId && postingId !== id) navigate(`/admin/spes/postings/${postingId}/edit`, { replace: true });
    } finally {
      coverAbortRef.current = null;
      setCoverUploading(false);
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
  const message = errorCode ? translateErrorCode(errorCode, t("spes.admin.saveFailed")) : "";
  const errorField = FIELD_OF_CODE[errorCode] || "";
  const fieldError = (name) => (errorField === name ? message : "");
  const barError = errorCode && !errorField ? message : "";
  const storedCover = existingCover && !removeCover ? { url: resolveAssetUrl(existingCover), name: t("spesPostings.form.coverCurrent") } : null;

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
        <Section title={t("spesPostings.form.basics")}>
          <Field id="spes-title" label={t("spesPostings.form.title")} required error={fieldError("title")}>
            <input type="text" value={form.title} maxLength={180} required onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field id="spes-description" label={t("spesPostings.form.description")}>
            <textarea rows={5} maxLength={8000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </Section>

        <Section title={t("spesPostings.form.cover")}>
          <FileUpload
            label={t("spesPostings.form.coverLabel")}
            showBadge={false}
            limits={SPES_COVER_LIMITS}
            hint={t("spesPostings.form.coverHint", { coverMax: bytesToMb(SPES_COVER_LIMITS.maxBytes) })}
            file={coverFile}
            existing={coverFile ? null : storedCover}
            uploading={coverUploading}
            progress={coverProgress}
            error={coverError}
            disabled={Boolean(saving) && !coverUploading}
            fileStateLabel={coverFile ? t("upload.ready") : ""}
            onSelect={pickCover}
            onRemove={clearCover}
            onCancel={() => coverAbortRef.current?.abort()}
          />
        </Section>

        <Section title={t("spesPostings.form.period")}>
          <div className="spes-form__grid">
            <Field id="spes-opens" label={t("spesPostings.form.opensAt")}>
              <input type="datetime-local" value={form.opensAt} onChange={(e) => set("opensAt", e.target.value)} />
            </Field>
            <Field id="spes-deadline" label={t("spesPostings.form.deadline")} error={fieldError("deadline")}>
              <input type="datetime-local" value={form.applicationDeadline} onChange={(e) => set("applicationDeadline", e.target.value)} />
            </Field>
            <Field id="spes-slots" label={t("spesPostings.form.slots")} error={fieldError("slots")}>
              <input type="number" min="0" step="1" inputMode="numeric" value={form.slots} onChange={(e) => set("slots", e.target.value)} />
            </Field>
          </div>
          <p className="spes-field__hint">{t("spesPostings.form.periodHint")}</p>
        </Section>

        <Section title={t("spesPostings.form.documents")}>
          <div className="spes-check-list">
            {FIXED_DOCS.map((slot) => (
              <CheckRow key={slot} id={`spes-doc-${slot}`} checked={form.docs[slot]} onChange={(v) => setDoc(slot, v)} label={t(`spes.docs.slot.${slot}`)} />
            ))}
            <CheckRow id="spes-doc-academic" checked={form.docs.academic} onChange={(v) => setDoc("academic", v)} label={t("spesPostings.form.academicOrOsy")} />
          </div>
          <Field id="spes-requirements" label={t("spesPostings.form.requirements")}>
            <textarea rows={3} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder={t("spesPostings.form.requirementsHint")} />
          </Field>
        </Section>

        <Section title={t("spesPostings.form.guardian")}>
          <Field id="spes-guardian" label={t("spesPostings.form.guardianLabel")} hint={t("spesPostings.form.guardianHint")}>
            <select value={form.guardianRequired} onChange={(e) => set("guardianRequired", e.target.value)}>
              <option value="inherit">{t("spesPostings.form.guardianInherit")}</option>
              <option value="yes">{t("spesPostings.form.guardianYes")}</option>
              <option value="no">{t("spesPostings.form.guardianNo")}</option>
            </select>
          </Field>
        </Section>

        <Section title={t("spesPostings.form.results")}>
          <Field id="spes-results-summary" label={t("spesPostings.form.resultsSummary")}>
            <textarea rows={3} value={form.resultsSummary} onChange={(e) => set("resultsSummary", e.target.value)} />
          </Field>
          <Field id="spes-results-url" label={t("spesPostings.form.resultsUrl")}>
            <input type="url" value={form.resultsUrl} onChange={(e) => set("resultsUrl", e.target.value)} />
          </Field>
          <div className="spes-check-list">
            <CheckRow id="spes-publish-list" checked={form.publishAcceptedList} onChange={(v) => set("publishAcceptedList", v)} label={t("spesPostings.form.publishList")} />
            <CheckRow id="spes-expose-scores" checked={form.exposeScores} onChange={(v) => set("exposeScores", v)} label={t("spesPostings.form.exposeScores")} />
          </div>
        </Section>

        {!published ? (
          <Section title={t("spesPostings.form.visibility")}>
            <div className="spes-check-list">
              <CheckRow
                id="spes-also-news"
                checked={form.alsoPostToNews}
                onChange={(v) => set("alsoPostToNews", v)}
                label={t("spesPostings.form.alsoNews")}
                hint={t("spesPostings.form.alsoNewsHint")}
              />
            </div>
          </Section>
        ) : null}

        <div className="spes-form__bar">
          <div className="spes-form__bar-msg">
            {barError ? <p className="spes-field__error" role="alert">{barError}</p> : null}
          </div>
          <div className="spes-form__bar-actions">
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
        </div>
      </form>
    </div>
  );
}
