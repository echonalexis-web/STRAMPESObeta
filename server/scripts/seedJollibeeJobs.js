/**
 * Seed 10 restaurant job vacancies for the employer "Jollibee Fastfood".
 *
 * Usage (from the server/ directory):
 *   node scripts/seedJollibeeJobs.js
 *   node scripts/seedJollibeeJobs.js --reset     # delete this employer's existing
 *                                                # non-archived jobs first
 *   node scripts/seedJollibeeJobs.js --employer "Some Other Name"
 *
 * All 10 are created at once with Promise.all. They are posted as "active" so
 * they land in the Job Postings tab and (being > 4) flip the Applicants-tab
 * job rail into its compact picker mode. Applicant-driven bits ("New" pill,
 * funnel counts) stay at zero until real applications exist.
 */

const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../.env") });

const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");

const FALLBACK_MONGO_URI =
  "mongodb+srv://alexis:ecjan05@stram-peso.nevsgla.mongodb.net/?appName=STRAM-PESO";

const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const employerFlagIdx = args.indexOf("--employer");
const EMPLOYER_NAME =
  employerFlagIdx !== -1 && args[employerFlagIdx + 1]
    ? args[employerFlagIdx + 1]
    : "Jollibee Fastfood";

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysAhead = (n) => new Date(Date.now() + n * 86400000);

const q = (type, value, optional = false) => ({ type, value, optional });

// title, jobType, slots, salary, location, createdDaysAgo, deadline, qualifications
const JOB_BLUEPRINTS = [
  {
    title: "Service Crew",
    jobType: "Full-time",
    slots: 8,
    salary: "PHP 610/day",
    location: "Boac, Marinduque, Region IV-B",
    createdDaysAgo: 1,
    deadline: daysAhead(21),
    description:
      "Front-line dining service: taking orders, assembling trays, keeping the counter and dining area clean, and giving every guest a fast, friendly experience during peak hours.",
    qualifications: [
      q("education", "High school graduate or Senior High School graduate"),
      q("experience", "Open to fresh graduates; QSR experience a plus", true),
      q("skill", "Customer service"),
      q("skill", "Cash handling", true),
      q("skill", "Teamwork"),
      q("skill", "Standing for long shifts"),
    ],
  },
  {
    title: "Cashier",
    jobType: "Full-time",
    slots: 4,
    salary: "PHP 15,000 - 17,000",
    location: "Santa Cruz, Marinduque, Region IV-B",
    createdDaysAgo: 3,
    deadline: daysAhead(14),
    description:
      "Operate the POS, process cash and e-wallet payments, reconcile the drawer at shift end, and upsell current promos while keeping the line moving.",
    qualifications: [
      q("education", "Senior High School graduate"),
      q("experience", "At least 6 months as a cashier or teller"),
      q("skill", "POS systems"),
      q("skill", "Cash handling"),
      q("skill", "Basic math accuracy"),
      q("skill", "Attention to detail"),
    ],
  },
  {
    title: "Cook / Kitchen Crew",
    jobType: "Full-time",
    slots: 5,
    salary: "PHP 16,000 - 19,000",
    location: "Gasan, Marinduque, Region IV-B",
    createdDaysAgo: 5,
    deadline: daysAhead(30),
    description:
      "Prepare menu items to brand spec on the fryer, grill, and assembly line, follow food-safety and portioning standards, and keep the station stocked and sanitised.",
    qualifications: [
      q("education", "High school graduate"),
      q("certification", "Food Safety / Sanitation certificate", true),
      q("experience", "1+ year in a commercial or fast-food kitchen"),
      q("skill", "Food preparation"),
      q("skill", "Kitchen safety"),
      q("skill", "Line cooking under time pressure"),
    ],
  },
  {
    title: "Store Supervisor",
    jobType: "Full-time",
    slots: 1,
    salary: "PHP 22,000 - 26,000",
    location: "Boac, Marinduque, Region IV-B",
    createdDaysAgo: 8,
    deadline: daysAhead(30),
    description:
      "Own a shift end to end: crew scheduling and briefings, cash and inventory controls, daily sales targets, food-safety audits, and handling escalated customer concerns.",
    qualifications: [
      q("education", "College graduate (Hospitality, Business, or related)"),
      q("experience", "2+ years supervising a QSR or retail team"),
      q("skill", "Team leadership"),
      q("skill", "Inventory management"),
      q("skill", "Sales reporting"),
      q("skill", "Conflict resolution"),
      q("skill", "Scheduling"),
    ],
  },
  {
    title: "Delivery Rider",
    jobType: "Full-time",
    slots: 6,
    salary: "PHP 14,000 + trip incentives",
    location: "Mogpog, Marinduque, Region IV-B",
    createdDaysAgo: 10,
    deadline: daysAhead(2),
    description:
      "Deliver orders quickly and safely within the delivery zone, handle cash-on-delivery, keep the food hot-bag sanitised, and maintain your assigned motorcycle.",
    qualifications: [
      q("license", "Valid Professional Driver's License (restriction 1)"),
      q("experience", "1+ year of motorcycle delivery experience"),
      q("skill", "Safe driving"),
      q("skill", "Route knowledge of Marinduque"),
      q("skill", "Customer service"),
      q("skill", "Basic motorcycle maintenance", true),
    ],
  },
  {
    title: "Kitchen Steward / Dishwasher",
    jobType: "Part-time",
    slots: 3,
    salary: "PHP 550/day",
    location: "Santa Cruz, Marinduque, Region IV-B",
    createdDaysAgo: 12,
    deadline: null,
    description:
      "Keep the kitchen running: wash and sanitise wares and utensils, manage waste segregation, restock cleaning supplies, and support the cooks during rush.",
    qualifications: [
      q("education", "At least high school level"),
      q("experience", "No experience required; willing to be trained"),
      q("skill", "Sanitation"),
      q("skill", "Physical stamina"),
      q("skill", "Reliability"),
    ],
  },
  {
    title: "Barista",
    jobType: "Part-time",
    slots: 2,
    salary: "PHP 600/day",
    location: "Boac, Marinduque, Region IV-B",
    createdDaysAgo: 15,
    deadline: daysAhead(10),
    description:
      "Prepare hot and iced beverages and desserts to spec, run the espresso and blender station, keep the bar clean, and recommend add-ons to guests.",
    qualifications: [
      q("education", "Senior High School graduate"),
      q("experience", "6+ months as a barista or beverage crew", true),
      q("skill", "Drink preparation"),
      q("skill", "Speed and consistency"),
      q("skill", "Customer service"),
      q("skill", "Cash handling"),
    ],
  },
  {
    title: "Shift Manager",
    jobType: "Full-time",
    slots: 2,
    salary: "PHP 19,000 - 23,000",
    location: "Buenavista, Marinduque, Region IV-B",
    createdDaysAgo: 18,
    deadline: daysAhead(20),
    description:
      "Run the floor and kitchen during your shift: deployment, speed-of-service targets, cash pickups, temperature and cleanliness checks, and coaching crew in the moment.",
    qualifications: [
      q("education", "College undergraduate or graduate"),
      q("experience", "1+ year as a team leader or shift manager in food service"),
      q("skill", "People management"),
      q("skill", "Decision making under pressure"),
      q("skill", "Food safety compliance"),
      q("skill", "Basic P&L awareness", true),
    ],
  },
  {
    title: "Baker / Pastry Assistant",
    jobType: "Full-time",
    slots: 2,
    salary: "PHP 16,000 - 18,500",
    location: "Gasan, Marinduque, Region IV-B",
    createdDaysAgo: 22,
    deadline: daysAhead(30),
    description:
      "Bake buns, pies, and pastries to production schedule, monitor proofing and oven times, rotate stock with FIFO, and keep the bakery area to sanitation standard.",
    qualifications: [
      q("education", "High school graduate"),
      q("certification", "TESDA NC II in Bread and Pastry Production", true),
      q("experience", "1+ year in a bakery or commissary"),
      q("skill", "Baking"),
      q("skill", "Recipe and portion control"),
      q("skill", "Food safety"),
    ],
  },
  {
    title: "Dining Area Attendant / Busser",
    jobType: "Part-time",
    slots: 4,
    salary: "PHP 540/day",
    location: "Torrijos, Marinduque, Region IV-B",
    createdDaysAgo: 29,
    deadline: null,
    description:
      "Reset and sanitise tables between guests, manage the self-service and condiment stations, assist guests with trays and seating, and keep restrooms checked hourly.",
    qualifications: [
      q("education", "At least high school level"),
      q("experience", "Open to fresh applicants"),
      q("skill", "Cleaning and sanitation"),
      q("skill", "Guest assistance"),
      q("skill", "Attention to detail"),
    ],
  },
];

const parseSalaryNumbers = (raw) => {
  const nums = [...String(raw || "").matchAll(/\d[\d,]*/g)].map((m) =>
    Number(m[0].replace(/,/g, ""))
  );
  if (!nums.length) return { salaryMin: null, salaryMax: null };
  return { salaryMin: Math.min(...nums), salaryMax: Math.max(...nums) };
};

const buildJobDoc = (bp, employerId) => {
  const created = daysAgo(bp.createdDaysAgo);
  const { salaryMin, salaryMax } = parseSalaryNumbers(bp.salary);
  return {
    title: bp.title,
    description: bp.description,
    location: bp.location,
    salary: bp.salary,
    salaryMin,
    salaryMax,
    industry: "Hospitality & Tourism",
    workNature: "onsite",
    jobType: bp.jobType,
    slots: bp.slots,
    applicationDeadline: bp.deadline || null,
    qualifications: bp.qualifications.map((item, order) => ({ ...item, order })),
    employer: employerId,
    status: "active",
    isActive: true,
    createdAt: created,
    updatedAt: created,
  };
};

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || FALLBACK_MONGO_URI;
  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  try {
    const rx = new RegExp(`^${EMPLOYER_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const employer = await User.findOne({
      role: "employer",
      $or: [{ name: rx }, { companyName: rx }],
    });

    if (!employer) {
      console.error(
        `❌ No employer found with name/companyName "${EMPLOYER_NAME}". ` +
          `Create/verify that account first, or pass --employer "Exact Name".`
      );
      process.exitCode = 1;
      return;
    }
    console.log(`👔 Employer: ${employer.name} <${employer.email}>  (${employer._id})`);

    if (RESET) {
      const del = await JobVacancy.deleteMany({
        employer: employer._id,
        archived: { $ne: true },
      });
      console.log(`🧹 --reset: removed ${del.deletedCount} existing non-archived job(s)`);
    }

    const docs = JOB_BLUEPRINTS.map((bp) => buildJobDoc(bp, employer._id));

    // Create all 10 at once.
    const results = await Promise.all(docs.map((d) => JobVacancy.create(d)));

    console.log(`\n🍟 Inserted ${results.length} restaurant jobs for ${employer.name}:`);
    results
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((j) => {
        const dl = j.applicationDeadline
          ? j.applicationDeadline.toISOString().slice(0, 10)
          : "no deadline";
        console.log(
          `   • ${j.title.padEnd(30)} ${String(j.slots).padStart(2)} slots  ` +
            `${j.jobType.padEnd(10)} posted ${j.createdAt.toISOString().slice(0, 10)}  (${dl})`
        );
      });
    console.log(
      "\nOpen the Employer Dashboard → Job Postings (table) and Applicants (the job rail is now a picker)."
    );
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected");
  }
})();
