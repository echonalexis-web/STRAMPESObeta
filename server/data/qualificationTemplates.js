// Built-in ("system") qualification templates for common job titles in the
// Philippines. These are read-only and always returned to every employer
// alongside their own saved ("custom") templates. Employers cannot edit or
// delete these; they can only load them and then tweak the result on a job.
//
// Shape mirrors the `qualificationSchema` sub-document on JobVacancy so the
// items can be dropped straight onto a job posting.

const SYSTEM_QUALIFICATION_TEMPLATES = [
  {
    slug: "teacher",
    name: "Teacher",
    jobTitle: "Teacher",
    items: [
      { type: "education", value: "Bachelor's degree in Education", optional: false },
      { type: "license", value: "Professional Teacher License", optional: false },
      { type: "experience", value: "2+ years of teaching experience", optional: false },
      { type: "skill", value: "Lesson planning", optional: false },
      { type: "skill", value: "Classroom management", optional: false },
      { type: "skill", value: "Student assessment", optional: false },
      { type: "skill", value: "Patience", optional: false },
      { type: "skill", value: "Communication", optional: false },
    ],
  },
  {
    slug: "nurse",
    name: "Nurse",
    jobTitle: "Nurse",
    items: [
      { type: "education", value: "Bachelor's degree in Nursing", optional: false },
      { type: "license", value: "Registered Nurse (RN) license", optional: false },
      { type: "experience", value: "1+ year of clinical experience", optional: false },
      { type: "skill", value: "Patient care", optional: false },
      { type: "skill", value: "Medical terminology", optional: false },
      { type: "skill", value: "Vital signs monitoring", optional: false },
      { type: "skill", value: "CPR certification", optional: true },
    ],
  },
  {
    slug: "accountant",
    name: "Accountant",
    jobTitle: "Accountant",
    items: [
      { type: "education", value: "Bachelor's degree in Accounting", optional: false },
      { type: "certification", value: "CPA certification (preferred)", optional: true },
      { type: "experience", value: "2+ years of accounting experience", optional: false },
      { type: "skill", value: "QuickBooks / Accounting software", optional: false },
      { type: "skill", value: "Excel proficiency", optional: false },
      { type: "skill", value: "Financial reporting", optional: false },
      { type: "skill", value: "Tax preparation", optional: true },
    ],
  },
  {
    slug: "general-manager",
    name: "General Manager",
    jobTitle: "General Manager",
    items: [
      { type: "education", value: "Bachelor's degree in Business Administration or related", optional: false },
      { type: "experience", value: "5+ years of management experience", optional: false },
      { type: "skill", value: "Leadership", optional: false },
      { type: "skill", value: "Strategic planning", optional: false },
      { type: "skill", value: "Financial management", optional: false },
      { type: "skill", value: "Team building", optional: false },
      { type: "skill", value: "Problem solving", optional: false },
      { type: "skill", value: "Communication", optional: false },
    ],
  },
  {
    slug: "caregiver",
    name: "Caregiver",
    jobTitle: "Caregiver",
    items: [
      { type: "education", value: "High school diploma or equivalent", optional: false },
      { type: "certification", value: "Caregiving certification (preferred)", optional: true },
      { type: "experience", value: "1+ year of caregiving experience", optional: false },
      { type: "skill", value: "Patient care", optional: false },
      { type: "skill", value: "Hygiene care", optional: false },
      { type: "skill", value: "Mobility assistance", optional: false },
      { type: "skill", value: "Patience", optional: false },
      { type: "skill", value: "Communication", optional: false },
      { type: "skill", value: "Basic first aid", optional: true },
    ],
  },
  {
    slug: "chef-cook",
    name: "Chef / Cook",
    jobTitle: "Cook",
    items: [
      { type: "education", value: "High school diploma or equivalent", optional: false },
      { type: "certification", value: "Culinary Arts certification (preferred)", optional: true },
      { type: "experience", value: "2+ years of kitchen experience", optional: false },
      { type: "skill", value: "Food preparation", optional: false },
      { type: "skill", value: "Cooking techniques", optional: false },
      { type: "skill", value: "Kitchen safety", optional: false },
      { type: "skill", value: "Sanitation", optional: false },
      { type: "skill", value: "Menu planning", optional: true },
      { type: "skill", value: "Inventory management", optional: true },
    ],
  },
  {
    slug: "driver",
    name: "Driver",
    jobTitle: "Driver",
    items: [
      { type: "license", value: "Professional Driver's License", optional: false },
      { type: "experience", value: "2+ years of driving experience", optional: false },
      { type: "skill", value: "Safe driving", optional: false },
      { type: "skill", value: "Route planning", optional: false },
      { type: "skill", value: "Vehicle maintenance", optional: false },
      { type: "skill", value: "Customer service", optional: false },
    ],
  },
  {
    slug: "receptionist",
    name: "Receptionist",
    jobTitle: "Receptionist",
    items: [
      { type: "education", value: "High school diploma or equivalent", optional: false },
      { type: "experience", value: "1+ year of receptionist or front desk experience", optional: false },
      { type: "skill", value: "Customer service", optional: false },
      { type: "skill", value: "Phone etiquette", optional: false },
      { type: "skill", value: "Organizational skills", optional: false },
      { type: "skill", value: "Microsoft Office Suite", optional: false },
      { type: "skill", value: "Multitasking", optional: false },
    ],
  },
  {
    slug: "sales-associate",
    name: "Sales Associate",
    jobTitle: "Sales Associate",
    items: [
      { type: "education", value: "High school diploma or equivalent", optional: false },
      { type: "experience", value: "1+ year of sales or retail experience", optional: false },
      { type: "skill", value: "Sales techniques", optional: false },
      { type: "skill", value: "Customer service", optional: false },
      { type: "skill", value: "Product knowledge", optional: false },
      { type: "skill", value: "Communication", optional: false },
      { type: "skill", value: "POS systems", optional: false },
    ],
  },
  {
    slug: "hr-officer",
    name: "HR Officer",
    jobTitle: "HR Officer",
    items: [
      { type: "education", value: "Bachelor's degree in Human Resources or related", optional: false },
      { type: "experience", value: "2+ years of HR experience", optional: false },
      { type: "skill", value: "Recruitment", optional: false },
      { type: "skill", value: "Employee relations", optional: false },
      { type: "skill", value: "Payroll administration", optional: false },
      { type: "skill", value: "Compliance", optional: false },
      { type: "skill", value: "Communication", optional: false },
    ],
  },
];

// Serialised form the API returns for a system template. `id` is a stable
// synthetic string ("system:<slug>") so the client can key/select on it the
// same way it does for a real Mongo _id.
const serializeSystemTemplates = () =>
  SYSTEM_QUALIFICATION_TEMPLATES.map((tpl) => ({
    id: `system:${tpl.slug}`,
    name: tpl.name,
    jobTitle: tpl.jobTitle || "",
    source: "system",
    items: tpl.items.map((item, index) => ({ ...item, order: index })),
  }));

module.exports = {
  SYSTEM_QUALIFICATION_TEMPLATES,
  serializeSystemTemplates,
};
