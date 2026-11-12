// Suggestion lists for the profile wizard's typeahead fields (Citizenship, civil
// service eligibility, PRC license). They only help the user type: any other text is
// still accepted. There was no existing list for these three fields in the code, so
// they live here (next to the other client option lists in data/).
//
// NEEDS PESO CONFIRMATION: the entries below are common, publicly known names and
// have not been reviewed by PESO, the Civil Service Commission or the PRC. No official
// codes are included. PESO should confirm or amend the wording before release.

// "Filipino" first; the rest alphabetical.
export const NATIONALITIES = [
  "Filipino",
  "Afghan", "Algerian", "American", "Argentine", "Australian", "Austrian", "Bangladeshi", "Belgian",
  "Brazilian", "British", "Bruneian", "Bulgarian", "Cambodian", "Canadian", "Chilean", "Chinese",
  "Colombian", "Croatian", "Cuban", "Czech", "Danish", "Dutch", "Egyptian", "Emirati", "Ethiopian",
  "Finnish", "French", "German", "Ghanaian", "Greek", "Hungarian", "Indian", "Indonesian", "Iranian",
  "Iraqi", "Irish", "Israeli", "Italian", "Jamaican", "Japanese", "Jordanian", "Kenyan", "Korean",
  "Kuwaiti", "Laotian", "Lebanese", "Malaysian", "Mexican", "Moroccan", "Myanmar", "Nepalese",
  "New Zealander", "Nigerian", "Norwegian", "Pakistani", "Peruvian", "Polish", "Portuguese", "Qatari",
  "Romanian", "Russian", "Saudi", "Singaporean", "South African", "Spanish", "Sri Lankan", "Swedish",
  "Swiss", "Syrian", "Taiwanese", "Thai", "Turkish", "Ukrainian", "Venezuelan", "Vietnamese",
];

// Civil service eligibilities commonly listed on an NSRP form.
export const CIVIL_SERVICE_ELIGIBILITIES = [
  "CSE - Professional Pen and Paper Test",
  "CSE - Sub-Professional Pen and Paper Test",
  "CSE - Professional Computer-Assisted Test",
  "CSE - Sub-Professional Computer-Assisted Test",
  "Career Service Professional",
  "Career Service Sub-Professional",
  "Career Executive Service Eligibility",
  "Honor Graduate Eligibility (PD 907)",
  "Barangay Official Eligibility (RA 7160)",
  "Barangay Health Worker Eligibility (RA 7883)",
  "Barangay Nutrition Scholar Eligibility (PD 1569)",
  "Sanggunian Member Eligibility (RA 10156)",
  "Skills Eligibility (Category II)",
  "Scientific and Technological Specialist Eligibility (PD 997)",
  "Bar/Board Examination Eligibility (RA 1080)",
  "Drug Enforcement Officer Eligibility",
  "Fire Officer Eligibility (RA 6975)",
  "Police Officer Eligibility (NAPOLCOM)",
  "Veteran Preference Rating",
];

// Professions regulated by the Professional Regulation Commission.
export const PRC_PROFESSIONS = [
  "Registered Nurse",
  "Licensed Professional Teacher",
  "Certified Public Accountant",
  "Civil Engineer",
  "Electrical Engineer",
  "Registered Electrical Engineer",
  "Mechanical Engineer",
  "Electronics Engineer",
  "Chemical Engineer",
  "Geodetic Engineer",
  "Agricultural and Biosystems Engineer",
  "Sanitary Engineer",
  "Mining Engineer",
  "Geologist",
  "Architect",
  "Interior Designer",
  "Landscape Architect",
  "Environmental Planner",
  "Master Plumber",
  "Registered Master Electrician",
  "Physician",
  "Dentist",
  "Pharmacist",
  "Medical Technologist",
  "Midwife",
  "Physical Therapist",
  "Occupational Therapist",
  "Respiratory Therapist",
  "Radiologic Technologist",
  "X-Ray Technologist",
  "Optometrist",
  "Nutritionist-Dietitian",
  "Psychologist",
  "Psychometrician",
  "Social Worker",
  "Librarian",
  "Criminologist",
  "Forester",
  "Agriculturist",
  "Fisheries Technologist",
  "Veterinarian",
  "Chemist",
  "Customs Broker",
  "Real Estate Broker",
  "Real Estate Appraiser",
  "Real Estate Salesperson",
  "Marine Deck Officer",
  "Marine Engineer Officer",
  "Naval Architect",
  "Aeronautical Engineer",
  "Speech-Language Pathologist",
];
