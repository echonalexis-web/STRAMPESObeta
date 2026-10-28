// client/src/constants/employerClassification.js
// Shared by EditProfile.jsx and EmployerOnboarding.jsx — previously four
// independently hardcoded, un-alphabetized lists (office type, classification
// type, and its two subtype branches). Stored values are lowercase; labels
// are the display-capitalized form — alphabetized by label.
export const OFFICE_TYPE_OPTIONS = [
  { value: "branch", label: "Branch" },
  { value: "main", label: "Main" },
];

export const CLASSIFICATION_TYPE_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
];

export const CLASSIFICATION_SUBTYPE_OPTIONS = {
  public: ["GOCC", "LGU", "NGA", "SUC/LUC"],
  private: [
    "D.O. 174 Contractor",
    "Direct Hire",
    "Local Recruitment Agency",
    "Overseas Recruitment Agency",
  ],
};
