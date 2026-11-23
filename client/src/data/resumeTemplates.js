// Visual layout themes shared by the Resume and Cover Letter builders on the
// Resume Studio page. Each key maps to a modifier class applied to the
// `.resume-doc` / `.letter-doc` preview root — see styles/resume-studio.css.
export const DOCUMENT_TEMPLATES = [
  {
    key: "classic",
    label: "Classic",
    description: "Clean single-column layout with green section accents.",
    className: "doc-theme--classic",
  },
  {
    key: "modernSidebar",
    label: "Modern Sidebar",
    description: "Two-column layout with a colored sidebar for contact details.",
    className: "doc-theme--modern-sidebar",
  },
  {
    key: "executive",
    label: "Executive",
    description: "Bold letterhead-style header for a formal, corporate look.",
    className: "doc-theme--executive",
  },
];

export const DEFAULT_TEMPLATE_KEY = "classic";

// The one layout used for an "ATS-friendly" resume (see utils/atsPdf.js): a single plain column. It is
// not in DOCUMENT_TEMPLATES because it is not a choice: picking the ATS type selects it.
export const ATS_TEMPLATE = {
  key: "ats",
  label: "ATS template",
  description: "Single column, plain text, no photo or icons.",
  className: "doc-theme--ats",
};

export const getTemplateClassName = (key) =>
  (key === ATS_TEMPLATE.key ? ATS_TEMPLATE : DOCUMENT_TEMPLATES.find((tpl) => tpl.key === key))?.className || DOCUMENT_TEMPLATES[0].className;
