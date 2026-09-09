# Employer Requirements Submission & Admin Notification System Analysis

## Executive Summary
The STRAM PESO platform currently has a **basic employer onboarding flow** but **lacks admin notification and approval workflow**. Employers register and complete requirements, but there is:
- ✗ No success confirmation dialog after submission
- ✗ No automated admin notification system
- ✗ No dedicated admin review/approval dashboard
- ✓ Manual verification status management in user list

---

## 1. EMPLOYER REQUIREMENTS SUBMISSION

### 1.1 Where Employers Submit Requirements

**File**: [client/src/pages/onboarding/EmployerOnboarding.jsx](client/src/pages/onboarding/EmployerOnboarding.jsx)

**Flow**:
1. Employer registers at `/register` → redirected to onboarding
2. 3-step form guides employer through company details
3. Step 1: Company info (name, industry, size, address)
4. Step 2: Contact details (phone, website, description, contacts)
5. Step 3: Review summary and submit

**Component**: `EmployerOnboarding.jsx` (Lines 1-400)

### 1.2 API Endpoint Used

**Endpoint**: `PUT /users/onboarding`  
**File**: [server/routes/userRoutes.js](server/routes/userRoutes.js#L23-L30)

```javascript
router.put(
  "/onboarding",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserUpdate,
  validateRequest,
  completeOnboarding  // <-- Handler
);
```

**Handler**: [server/controllers/userController.js](server/controllers/userController.js#L44-L165)

### 1.3 Data Structure Submitted

**Frontend Payload** (EmployerOnboarding.jsx, lines 105-125):
```javascript
const payload = {
  // Basic company info (User model)
  companyName: string,
  industry: string,
  companySize: "1-10" | "11-50" | "51-200" | "201-500" | "500+",
  businessAddress: string,
  website: url,
  companyDescription: string,
  phone: string,
  
  // NSRP fields (EmployerProfile)
  tradeName: string,
  acronym: string,
  tin: string,
  officeType: "main" | "branch",
  employerClassification: {
    type: "public" | "private",
    subtype: enum // NGA, LGU, GOCC, SUC/LUC, Direct Hire, etc.
  },
  totalWorkforceSize: "micro" | "small" | "medium" | "large",
  ownerName: string,
  contactPersonName: string,
  contactPersonPosition: string,
  fax: string,
  businessAddressStructured: {
    street: string,
    barangay: string,
    municipality: string,
    province: string
  }
};
```

**Backend Processing** (userController.js, lines 60-90):
```javascript
// Updates User model
const commonUpdates = {
  companyName, industry, companySize, website, companyDescription, businessAddress, phone,
  hasCompletedOnboarding: true,
  onboardingComplete: true
};
await User.findByIdAndUpdate(userId, commonUpdates);

// Updates EmployerProfile model
const profileData = {
  tradeName, acronym, tin, officeType, employerClassification,
  totalWorkforceSize, businessAddress: businessAddressStructured,
  ownerName, contactPersonName, contactPersonPosition, fax
};
await upsertProfile(userId, "employer", profileData);
```

### 1.4 Current UI Feedback/Confirmation

**ISSUE**: No success dialog is shown to employer.

**Current Flow** (EmployerOnboarding.jsx, lines 115-123):
```javascript
const submitOnboarding = async () => {
  try {
    const { data } = await usersAPI.completeOnboarding(payload);
    const token = localStorage.getItem("token");
    if (token && data.user) login(token, data.user);
    navigate("/employer-dashboard");  // <-- Silently redirects
  } catch (err) {
    setSubmitError(err.response?.data?.message || "Failed...");
  }
};
```

**Result**: 
- Employer sees "Finishing setup..." loading state
- No success message
- Silently redirected to employer dashboard
- Employer doesn't know their account is pending admin review

---

## 2. ADMIN NOTIFICATION SYSTEM

### 2.1 Current State: ✗ NO NOTIFICATION SYSTEM

**Notification Model Exists** [server/models/Notification.js](server/models/Notification.js):
```javascript
const notificationSchema = new Schema({
  recipient: { type: Schema.Types.ObjectId, ref: "User" },
  actor: { type: Schema.Types.ObjectId, ref: "User" },
  type: {
    enum: ["system", "message", "job_application", "application_status", "admin_action"],
    default: "system"
  },
  title: string,
  message: string,
  relatedEntityType: enum,
  relatedEntityId: ObjectId,
  actionUrl: string,
  metadata: object
});
```

**Notification Service Exists** [server/services/notificationService.js](server/services/notificationService.js):
```javascript
exports.createNotificationForUser = async ({
  recipientId,
  actorId,
  type = "system",
  title,
  message,
  relatedEntityType,
  relatedEntityId,
  actionUrl,
  metadata,
  io = null, // Socket.io for real-time
});
```

**BUT**: This is **NEVER CALLED** when:
- Employer registers
- Employer completes onboarding
- Admin approves/rejects employer

### 2.2 Do Admins Get Notified?

**Answer**: NO. Currently:
- No notification created when employer registers
- No notification created when employer completes onboarding
- No email notifications sent
- No in-app notification badge

### 2.3 Is There an Admin Dashboard for Reviews?

**Partial**: Yes, but very basic.

**File**: [client/src/pages/AdminDashboard.jsx](client/src/pages/AdminDashboard.jsx)

**Current Admin Panel Features**:
- ✓ View all users with filters (role, search)
- ✓ See verification status badge for each employer
- ✓ Inline verification buttons (Unverified/Pending/Verified)
- ✗ No dedicated "Pending Review" section
- ✗ No way to see which employers just completed onboarding
- ✗ No notifications highlighting pending employers
- ✗ No batch approval workflow

**Verification UI** (AdminDashboard.jsx, lines 750-800):
```javascript
<tr>
  <td>
    {row.role === "employer" ? (
      <span className={badge.className}>{badge.label}</span>  // Pending/Verified/Unverified
    ) : (
      <span>–</span>
    )}
  </td>
</tr>

// When admin clicks verification toggle:
{verificationTarget === row._id && row.role === "employer" ? (
  <tr>
    <td colSpan={6} className="admin-verification-row">
      <div>
        <button onClick={() => handleVerification(row, "unverified")}>Unverified</button>
        <button onClick={() => handleVerification(row, "pending")}>Pending</button>
        <button onClick={() => handleVerification(row, "verified")}>✓ Verified</button>
      </div>
    </td>
  </tr>
) : null}
```

### 2.4 How Are Pending Approvals Tracked?

**Method 1**: Manual search in user list
- Admin must go to Admin Dashboard → User Management
- Filter by "Employers" role
- Search or scroll through list
- Look for "Pending" verification badge

**Method 2**: View analytics
- Admin Dashboard shows count in stats:
  ```javascript
  pendingVerification = User.countDocuments({ 
    role: "employer", 
    verificationStatus: "pending" 
  })
  ```
- But no direct link to those users

**Verification Handler** (AdminDashboard.jsx, lines 355-380):
```javascript
const handleVerification = async (targetUser, status) => {
  setBusyUserId(targetUser._id);
  try {
    await adminAPI.updateEmployerVerification(targetUser._id, status);
    // Fetch updated users and analytics
    await Promise.all([fetchUsers(), fetchAnalytics()]);
    setVerificationTarget("");
    setVerificationError("");
  } catch (err) {
    setVerificationError(err.response?.data?.message || "Failed to update");
  } finally {
    setBusyUserId("");
  }
};
```

**API Call** (API endpoint):
```javascript
// [server/routes/adminRoutes.js#L24]
router.put("/users/:id/verification", validateMongoId("id"), sanitizeRequestBody, 
  updateEmployerVerification);

// [server/controllers/adminController.js#L291-313]
exports.updateEmployerVerification = async (req, res) => {
  const { verificationStatus } = req.body;
  if (!["unverified", "pending", "verified"].includes(verificationStatus)) {
    return res.status(400).json({ message: "Invalid verification status" });
  }
  
  const user = await User.findByIdAndUpdate(
    id,
    { $set: { verificationStatus } },
    { new: true, runValidators: true }
  );
  
  return res.json({ message: "Employer verification updated", user });
};
```

---

## 3. EMPLOYER ACCOUNT CREATION FLOW

### 3.1 When Does Account Get Created?

**Step 1: Registration** [server/routes/authRoutes.js#L32-L41]
```javascript
router.post(
  "/register/employer",
  sanitizeRequestBody,
  detectMaliciousPayload,
  validateUserRegistration,
  validateRequest,
  registerEmployer  // <-- in authController.js
);
```

**Handler** [server/controllers/authController.js#L64-L96]:
```javascript
exports.registerEmployer = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    
    // Create User with role="employer", verificationStatus="pending"
    const user = await User.create({
      name,
      email,
      password: hashed,
      role: "employer",
      verificationStatus: "pending",  // <-- Initially PENDING
    });

    // Create empty EmployerProfile
    await EmployerProfile.create({ userId: user._id });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(201).json({
      message: "Employer registered. Please complete your profile.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
```

**Timeline**:
1. ✓ Employer account created immediately
2. ✓ verificationStatus = "pending"
3. ✓ Employer can log in and view onboarding form
4. ✗ No notification to admin

### 3.2 Approval/Verification Status

**User Model Fields** [server/models/User.js#L27-L32]:
```javascript
verificationStatus: {
  type: String,
  enum: ["unverified", "pending", "verified"],
  default: "unverified",
},

hasCompletedOnboarding: { type: Boolean, default: false },
onboardingComplete: { type: Boolean, default: false },
```

**Status Meanings**:
- `"pending"` - Account created, waiting for onboarding + admin approval
- `"unverified"` - Admin set to unverified (rejected or reset)
- `"verified"` - Admin approved, employer can post jobs

**Access Control** [server/middleware/auth.js]:
```javascript
// Employer can only post jobs if isVerifiedEmployer middleware passes
const isVerifiedEmployer = (req, res, next) => {
  if (req.user.verificationStatus !== "verified") {
    return res.status(403).json({ message: "Employer account not verified" });
  }
  next();
};
```

**Example**: Job posting route [server/routes/employerRoutes.js#L25]:
```javascript
router.post("/jobs", 
  protect,           // Must be authenticated
  isEmployer,        // Must have role="employer"
  isVerifiedEmployer, // Must have verificationStatus="verified"
  createJob
);
```

---

## 4. USER MODEL EMPLOYER FIELDS

**File**: [server/models/User.js](server/models/User.js#L1-200)

```javascript
// ===== Employer-specific fields =====
companyName: { type: String, default: "" },
industry: { type: String, default: "" },
companySize: {
  type: String,
  enum: ["", "1-10", "11-50", "51-200", "201-500", "500+", "1001-5000", "5000+"],
  default: "",
},
website: { type: String, default: "" },
companyDescription: { type: String, default: "" },
businessAddress: { type: String, default: "" },

// ===== Verification & status =====
verificationStatus: {
  type: String,
  enum: ["unverified", "pending", "verified"],
  default: "unverified",
},
businessPermitUrl: { type: String, default: null },
registrationDocUrl: { type: String, default: null },
isActive: { type: Boolean, default: true },
hasCompletedOnboarding: { type: Boolean, default: false },
onboardingComplete: { type: Boolean, default: false },
```

---

## 5. EMPLOYERPROFILE MODEL STRUCTURE

**File**: [server/models/EmployerProfile.js](server/models/EmployerProfile.js)

```javascript
const employerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  
  // Business Identity
  tradeName: { type: String, default: "" },
  acronym: { type: String, default: "" },
  tin: { type: String, default: "" },
  
  // Office Type
  officeType: {
    type: String,
    enum: ["main", "branch"],
    default: null,
  },
  
  // Classification
  employerClassification: {
    type: {
      type: String,
      enum: ["public", "private"],
      default: null,
    },
    subtype: {
      type: String,
      enum: [
        "NGA",
        "LGU",
        "GOCC",
        "SUC/LUC",
        "Direct Hire",
        "Local Recruitment Agency",
        "Overseas Recruitment Agency",
        "D.O. 174 Contractor",
      ],
      default: null,
    },
  },
  
  // Firm Metrics
  totalWorkforceSize: {
    type: String,
    enum: ["micro", "small", "medium", "large"],
    default: null,
  },
  
  // Business Address (structured)
  businessAddress: {
    street: { type: String, default: "" },
    barangay: { type: String, default: "" },
    municipality: { type: String, default: "" },
    province: { type: String, default: "" },
  },
  
  // Corporate Contacts
  ownerName: { type: String, default: "" },
  contactPersonName: { type: String, default: "" },
  contactPersonPosition: { type: String, default: "" },
  fax: { type: String, default: "" },
  
  timestamps: true,
});

// Unique index on userId
employerProfileSchema.index({ userId: 1 }, { unique: true });
```

---

## 6. JOBVACANCY MODEL & QUALIFICATIONS STRUCTURE

**File**: [server/models/JobVacancy.js](server/models/JobVacancy.js)

```javascript
// Qualification sub-schema
const qualificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["education", "experience", "skill", "certification", "license", "other"],
    required: true,
  },
  value: {
    type: String,
    required: true,
    trim: true,
  },
  optional: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const jobVacancySchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, required: true },
  salary: { type: String, default: "" },
  
  // NEW: Structured qualifications
  qualifications: {
    type: [qualificationSchema],
    default: [],
    required: false,
  },
  
  // DEPRECATED: Kept for backward compatibility
  requirements: {
    type: String,
    default: "",
    required: false,
  },
  
  applicationDeadline: { type: Date, default: null },
  jobType: {
    type: String,
    enum: ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"],
    default: "Full-time",
  },
  slots: { type: Number, default: 1 },
  employer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ["active", "closed", "draft"], default: "active" },
  industry: { type: String, default: "" },
  workNature: { type: String, enum: ["remote", "onsite", "hybrid"], default: null },
  salaryMin: { type: Number, default: null },
  salaryMax: { type: Number, default: null },
});
```

**Example Qualifications Data** (created by [server/controllers/employerController.js](server/controllers/employerController.js#L40-L75)):
```javascript
qualifications: [
  {
    type: "education",
    value: "Bachelor's Degree in Computer Science",
    optional: false,
    order: 0
  },
  {
    type: "experience",
    value: "5+ years software development",
    optional: false,
    order: 1
  },
  {
    type: "skill",
    value: "React.js",
    optional: false,
    order: 2
  },
  {
    type: "skill",
    value: "MongoDB",
    optional: true,
    order: 3
  }
]
```

---

## 7. CURRENT UI/UX ISSUES IDENTIFIED

### Issue 1: No Success Confirmation After Onboarding
**Location**: [client/src/pages/onboarding/EmployerOnboarding.jsx#L115-123](client/src/pages/onboarding/EmployerOnboarding.jsx#L115-123)

**Current Behavior**:
```javascript
navigate("/employer-dashboard");  // Silent redirect
```

**Problem**: Employer doesn't know submission was successful or that account is pending review

**Recommendation**: Show success dialog before redirect

---

### Issue 2: Admin Has No Notification of New Employer Submissions
**Location**: No notification service call exists for new submissions

**Problem**:
- Admin must manually check user list
- No email notifications
- No in-app notifications
- Admins unaware of pending employers

**Recommendation**: Integrate notification service into registration/onboarding completion

---

### Issue 3: Admin Verification UI Is Hidden in User Table
**Location**: [client/src/pages/AdminDashboard.jsx#L750-800](client/src/pages/AdminDashboard.jsx#L750-800)

**Problem**:
- No dedicated "Pending Employers" view
- Verification buttons only appear when user row is expanded
- No visual highlight for pending employers
- No batch approval functionality

**Recommendation**: Add "Pending Review" section to admin dashboard

---

## 8. RECOMMENDED CHANGES NEEDED

### For Employer Dialog Prompt
**Location to add**: [client/src/pages/onboarding/EmployerOnboarding.jsx](client/src/pages/onboarding/EmployerOnboarding.jsx#L230-250)

**What to add**:
1. Success modal/dialog component showing:
   - ✓ Onboarding complete
   - Message: "Your account is now pending admin review"
   - Expected review timeline
   - What happens next
   - Button to go to dashboard

2. File to create: `client/src/components/OnboardingSuccessDialog.jsx`

**Example Implementation**:
```javascript
function OnboardingSuccessDialog({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="success-dialog">
        <h2>✓ Setup Complete!</h2>
        <p>Your employer account has been successfully created.</p>
        <p className="info">Your account is now pending review by our admin team. 
           You'll be notified once your account is approved.</p>
        <p>In the meantime, you can explore the platform and prepare your job listings.</p>
        <button onClick={onClose}>Go to Dashboard</button>
      </div>
    </Modal>
  );
}
```

### For Admin Notification System
**Files to modify**:
1. [server/controllers/authController.js](server/controllers/authController.js#L64-96) - Add notification on registration
2. [server/controllers/userController.js](server/controllers/userController.js#L44-165) - Add notification on onboarding completion
3. [server/controllers/adminController.js](server/controllers/adminController.js#L291-313) - Add notification on verification

**Example**:
```javascript
// In registerEmployer
const { createNotificationForUser } = require("../services/notificationService");

await createNotificationForUser({
  recipientId: adminId, // Get admin user ID
  type: "system",
  title: "New Employer Registration",
  message: `${user.name} (${user.email}) has registered. Account pending review.`,
  relatedEntityType: "user",
  relatedEntityId: user._id,
  actionUrl: `/admin/users/${user._id}`,
  metadata: { employerEmail: user.email, registeredAt: new Date() }
});
```

### For Admin Dashboard Review Panel
**File to modify**: [client/src/pages/AdminDashboard.jsx](client/src/pages/AdminDashboard.jsx)

**Add new section**:
```jsx
<section className="admin-pending-employers-section">
  <h2>Pending Employer Reviews ({pendingCount})</h2>
  
  <table className="admin-table">
    <thead>
      <tr>
        <th>Company Name</th>
        <th>Email</th>
        <th>Registered</th>
        <th>Onboarding</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {pendingEmployers.map(emp => (
        <tr key={emp._id}>
          <td>{emp.companyName}</td>
          <td>{emp.email}</td>
          <td>{formatDate(emp.createdAt)}</td>
          <td>{emp.hasCompletedOnboarding ? "✓" : "Incomplete"}</td>
          <td>
            <button onClick={() => viewEmployerProfile(emp._id)}>View Profile</button>
            <button onClick={() => approveEmployer(emp._id)}>Approve</button>
            <button onClick={() => rejectEmployer(emp._id)}>Reject</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

---

## 9. DATABASE RELATIONSHIPS DIAGRAM

```
User (Employer)
├── id
├── name
├── email
├── password
├── role: "employer"
├── verificationStatus: "pending"|"verified"|"unverified"
├── hasCompletedOnboarding: boolean
├── companyName
├── industry
├── companySize
├── website
├── businessAddress (string)
└── createdAt

    ↓ 1:1 Reference

EmployerProfile
├── userId (FK → User._id)
├── tradeName
├── acronym
├── tin
├── officeType
├── employerClassification {type, subtype}
├── totalWorkforceSize
├── businessAddress {street, barangay, municipality, province}
├── ownerName
├── contactPersonName
└── contactPersonPosition

    ↓ 1:Many Reference

JobVacancy
├── employer (FK → User._id)
├── title
├── description
├── location
├── qualifications: [{
│   ├── type: "education"|"experience"|"skill"|etc.
│   ├── value: string
│   ├── optional: boolean
│   └── order: number
│ }]
├── status: "active"|"closed"|"draft"
├── createdAt
└── updatedAt

    ↓ 1:Many Reference

JobApplication
├── vacancy (FK → JobVacancy._id)
├── applicant (FK → User._id / Jobseeker)
├── status: "pending"|"reviewed"|"shortlisted"|"rejected"|"hired"
├── appliedAt
└── updatedAt
```

---

## 10. SUMMARY TABLE

| Aspect | Status | File | Details |
|--------|--------|------|---------|
| **Employer Registration** | ✓ Works | authController.js#64 | Creates user with verificationStatus="pending" |
| **Employer Onboarding** | ✓ Works | userController.js#44 | Stores profile data in User + EmployerProfile |
| **Success Dialog** | ✗ Missing | EmployerOnboarding.jsx | Should show confirmation before redirect |
| **Admin Notification** | ✗ Missing | notificationService.js | Never called on registration/onboarding |
| **Admin Review Panel** | ⚠ Basic | AdminDashboard.jsx#750 | Only inline buttons in user table |
| **Verification System** | ✓ Works | adminController.js#291 | Can update status via API |
| **Job Requirements** | ✓ Works | JobVacancy.js | Qualifications array with type/value |
| **Access Control** | ✓ Works | auth.js | isVerifiedEmployer middleware enforced |
| **Notification Model** | ✓ Exists | Notification.js | Structure ready, not used |

---

## 11. API ENDPOINT SUMMARY

### Authentication Routes
```
POST /api/v1/auth/register/employer
  - Body: {name, email, password}
  - Returns: {token, user}
  - Creates: User(role="employer", verificationStatus="pending"), EmployerProfile

POST /api/v1/auth/login
  - Body: {email, password}
  - Returns: {token, user, verificationStatus}
```

### User Routes
```
PUT /api/v1/users/onboarding
  - Auth: Required (Bearer token)
  - Body: {companyName, industry, ...all profile fields}
  - Returns: {message, user, profile}
  - Updates: User model + EmployerProfile
```

### Admin Routes
```
GET /api/v1/admin/users?role=employer&search=
  - Auth: Required, isAdmin
  - Returns: {users[], total, totalPages, currentPage}
  - Includes: verificationStatus field

PUT /api/v1/admin/users/:id/verification
  - Auth: Required, isAdmin
  - Body: {verificationStatus}
  - Returns: {message, user}
  - Changes: User.verificationStatus

GET /api/v1/admin/analytics
  - Auth: Required, isAdmin
  - Returns: {totalEmployers, verifiedEmployers, pendingVerification, ...}
```

### Employer Routes (Requires isVerifiedEmployer)
```
GET /api/v1/employer/jobs
POST /api/v1/employer/jobs
  - Auth: Required, isEmployer, isVerifiedEmployer
  - Only accessible if verificationStatus="verified"
```

---

## 12. KEY FINDINGS & RECOMMENDATIONS

### Critical Issues
1. **No feedback loop for employers** - They don't know if submission succeeded or what to expect
2. **No admin awareness** - Admins manually search for pending employers
3. **No automated workflow** - Verification is completely manual
4. **No email notifications** - No way to alert admins/employers of status changes

### Quick Wins (Easy to Implement)
1. Add success dialog modal to onboarding form
2. Create admin notification when employer registers
3. Create admin notification when employer completes onboarding
4. Add "Pending Review" count badge on admin dashboard

### Medium Effort (1-2 Hours)
1. Create dedicated "Pending Employers" section in admin dashboard
2. Add employer verification status email notifications
3. Add employer welcome email with expectations

### Future Enhancements
1. Batch approval workflow for admins
2. Document verification uploads (business permit, TIN registration)
3. Admin comments/rejection reasons
4. Auto-verification based on document validation
5. Email templates for approval/rejection

---

Generated: 2026-08-05
Analysis by: GitHub Copilot
