# STRAMPESO Codebase Audit Report
**Date**: 2026-07-28  
**Scope**: Full stack assessment across user models, API patterns, state management, and real-time features

---

## 1. User Model (server/models/User.js)

### Existing Fields
The User model is a **unified schema for 3 roles**: resident (jobseeker), employer, admin

**Authentication Fields**:
- `name`, `email`, `password` (required)
- `role` (enum: "resident", "employer", "admin", default: "resident")
- `phone` (optional)

**Common Profile Fields**:
- `about` (string, default: "")
- `address` (optional)
- `profileImage` (optional)

**Jobseeker-Specific Fields**:
- `dateOfBirth`, `gender`
- `desiredJobTitle`, `skills` (array)
- `workExperience` (enum: Fresh Graduate → 5+ years)
- `educationalAttainment` (enum: Elementary → Doctorate)
- `availabilityStatus` (enum: Actively Looking, Open to Offers, Currently Employed)

**Employer-Specific Fields**:
- `companyName`, `industry`, `companySize` (enum with sizes up to 5000+)
- `website`, `companyDescription`, `businessAddress`

**Verification & Status**:
- `verificationStatus` (enum: "unverified", "pending", "verified")
- `businessPermitUrl`, `registrationDocUrl`, `resumeFile`, `validIdFile`
- `isActive` (boolean, default: true)
- `hasCompletedOnboarding`, `onboardingComplete` (both stored)

**Notifications**:
- `notifications` array with `{ message, isRead, createdAt }`

### Key Finding: No Followers/Following/Likes Arrays
❌ **NO** followers/following relationships exist  
❌ **NO** likes/favorites array for jobs or profiles  
✅ **EXISTING**: Conversation model tracks user relationships (user-to-user messaging only between residents ↔ employers)

**Related Separated Models**:
- `JobseekerProfile` - Extended details for jobseekers (address structures, employment status, disabilities)
- `EmployerProfile` - Extended details for employers (office type, classification, TIN, workforce metrics)

---

## 2. JobVacancy Model (server/models/JobVacancy.js)

### Structure & Fields

```javascript
// Core Job Fields
{
  title, description, location, salary (string),
  jobType: enum ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Remote"],
  slots: number (default: 1),
  applicationDeadline: Date,
  
  // Qualifications (NEW structured format)
  qualifications: [{
    type: enum ["education", "experience", "skill", "certification", "license", "other"],
    value: string,
    optional: boolean,
    order: number
  }],
  
  // Legacy (deprecated but kept for backward compatibility)
  requirements: string,
  
  // Status & Visibility
  employer: ObjectId (ref: User),
  isActive: boolean (default: true),
  status: enum ["active", "closed", "draft"],
  isFeatured: boolean,
  featuredOrder: number,
  
  // Filtering Fields (NEW)
  industry, workNature: enum ["remote", "onsite", "hybrid"],
  salaryMin, salaryMax: numbers,
  
  createdAt, updatedAt
}
```

### Key Finding: No Like/Favorite Tracking
❌ **NO** likes/favorites field in JobVacancy  
❌ **NO** view count or engagement metrics  
✅ **EXISTING**: Application counts tracked via JobApplication model (separate)

### Indexes Defined
```javascript
{ "qualifications.type": 1 }
{ "status": 1 }
{ "industry": 1 }
{ "workNature": 1 }
{ "location": 1 }
{ "salaryMin": 1, "salaryMax": 1 }
```

---

## 3. API Patterns (client/src/services/api.js)

### Architecture
- **Base URL**: `http://localhost:3000/api/v1` (dev) or `https://stram-peso.onrender.com/api/v1` (prod)
- **HTTP Client**: Axios with interceptors
- **Credentials**: `withCredentials: true`, timeout: 30000ms
- **Dual API Support**: Routes mounted at both `/api` and `/api/v1`

### Request Interceptor Pattern
```javascript
// Automatically adds Bearer token from localStorage
Authorization: `Bearer ${token}` (from localStorage.getItem("token"))
```

### Response Interceptor Patterns
1. **Rate Limiting (429)**: Exponential backoff retry (max 3 attempts, 2^n * 1000ms delay)
2. **Unauthorized (401)**: Redirects to /login after clearing token
3. **Network Errors**: Logged but not auto-retried
4. **Custom Delay**: `delay(ms)` helper used for UI smoothness (150ms for admin endpoints)

### API Objects Structure

#### `authAPI`
```javascript
register, login, registerEmployee, registerEmployer
generateInvite, getProfile, updateProfile, deleteAccount
```

#### `jobAPI`
```javascript
createJob, getJobs, getHomepageJobs, searchJobsWithSemantic
getJobById, updateJob, deleteJob, applyToJob
getEmployerJobs, getApplicationsForJob, getMyApplications
updateApplication, deleteApplication
```
**Key endpoint**: `/recommendations/jobs` (with semantic search params)

#### `adminAPI`
```javascript
getUsers (with page/limit/role/search params),
getAnalytics, getUserById,
getHomepageJobManagement, toggleHomepageFeature,
updateJobStatus, deleteJob,
updateUserRole, deactivateUser, reactivateUser,
updateEmployerVerification, deleteUser, generateInvite
```

#### `employerAPI`
```javascript
getStats, getProfileStats, getJobs, createJob, updateJob, deleteJob,
getApplicantsForJob, getRankedApplicants (with params),
updateApplicationStatus
```

#### `messageAPI`
```javascript
searchUsers, createConversation, getConversations,
getMessages (conversationId), sendMessage, deleteConversation,
getUnreadCount
```

#### `notificationAPI`
```javascript
getNotifications (with params), getUnreadCount,
markAsRead, markAllAsRead, deleteNotification
```

#### `usersAPI`
```javascript
completeOnboarding
```

### Naming Conventions
- **Endpoint style**: RESTful `/resources/{id}/action`
- **Parameters**: Query string for filters (`page`, `limit`, `search`, `role`)
- **Headers**: Consistent use of `getAuthHeader()` / `getAuthFormHeader()`
- **Naming**: camelCase for function names, kebab-case for routes

---

## 4. Frontend State Management

### Pattern: Context API Only (No Redux)

#### AuthContext (client/src/context/AuthContext.jsx)
**State**:
```javascript
user (normalized role), token, loading
```

**Methods**:
- `login(token, user)` - Sets token & user, stores in localStorage with 30-day expiry
- `logout()` - Clears state and localStorage
- `normalizeRole(role)` - Maps "employee"/"jobseeker" → "resident"
- `normalizeUser(user)` - Normalizes role before storing

**Key localStorage Keys**:
- `token`
- `user` (JSON stringified)
- `tokenExpiry` (30 days from login)

#### SocketContext (client/src/context/SocketContext.jsx)
**State**:
```javascript
socket (io instance), isConnected (boolean), userId
```

**Connection Pattern**:
```javascript
io(SOCKET_URL, {
  auth: { token: localStorage.getItem("token") },
  transports: ["websocket", "polling"],
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: 10,
  timeout: 20000
})
```

**Connection Events**:
- `connect` - Sets socket and isConnected
- `connect_error` - Handles auth failures
- `disconnect` - Clears socket on server disconnect

### No Global State Management
- No Redux, Zustand, or Recoil
- Heavy use of `useState` for local component state
- Prop drilling for shared state (see EmployerDashboard, JobBoard)
- Context provides only authentication and Socket.IO state

---

## 5. Icon Library: React Icons (Font Awesome)

### Currently Used
- **Package**: `react-icons/fa` (Font Awesome)
- **NO Material-UI icons**, **NO Lucide**, **NO Heroicons**

### Icon Usage Across Components
```javascript
// Example: JobBoard.jsx
import { FaSearch, FaMapMarkerAlt, FaBuilding, FaUserCircle, 
         FaBriefcase, FaCalendarAlt, FaFileAlt, FaUsers } from "react-icons/fa";

// Example: Navbar.jsx
import { FaEnvelope, FaUserCircle, FaChevronDown, FaBars, FaTimes, FaBell } from "react-icons/fa";

// Example: EditProfile.jsx
import { FaUser, FaEnvelope, FaPhone, FaBriefcase, FaBuilding, 
         FaMapMarkerAlt, FaCalendarAlt, FaUserGraduate, FaFileAlt, 
         FaUpload, FaTrash, FaExclamationTriangle, FaTimes, FaPlus, FaSave } from "react-icons/fa";
```

### Usage Pattern
- Imported directly into component files (no icon library abstraction)
- Used inline in JSX: `<FaSearch className="icon-class" />`
- No centralized icon registry

---

## 6. JobBoard Implementation (client/src/pages/JobBoard.jsx)

### State Management
```javascript
const [jobs, setJobs] = useState([]);
const [loading, setLoading] = useState(true);
const [selectedJob, setSelectedJob] = useState(null);
const [selectedEmployer, setSelectedEmployer] = useState(null);
const [applications, setApplications] = useState([]); // User's applications
const [viewingApplication, setViewingApplication] = useState(null);
const [editingApplication, setEditingApplication] = useState(null);
const [toastMessage, setToastMessage] = useState(null);
```

### Fetching Pattern
```javascript
const fetchJobs = async (filters = {}) => {
  setLoading(true);
  try {
    const [jobsResponse, applicationsResponse] = await Promise.all([
      jobAPI.searchJobsWithSemantic(params),    // Semantic search
      jobAPI.getMyApplications()                // User's past applications
    ]);
    setJobs(jobsResponse.data.jobs || []);
    setHasSkills(jobsResponse.data.hasSkills); // Server indicates if user has skills
    setApplications(applicationsResponse.data || []);
  } catch (err) {
    setError(err.response?.data?.message || "Failed to load jobs");
  } finally {
    setLoading(false);
  }
};
```

### Key Features
1. **Semantic Recommendation**: `/recommendations/jobs` endpoint for intelligent job matching
2. **Job Cards**: Display with match score (`getMatchClass()` for high/medium/low)
3. **Match Scoring**: `score * 100` percentage with color-coded badges
4. **Application Tracking**: Fetches user's previous applications to prevent duplicate apply attempts
5. **Modal Integration**: Uses `Modal` component for job detail view, `EmployerModal` for employer profile
6. **Qualifications Display**: Uses `QualificationsDisplay` component for structured qualification rendering

### Pagination
❌ **NO pagination implemented** - Loads all jobs into state  
✅ **Semantic filtering** via `/recommendations/jobs` with params object

### Job Display URL Pattern
```javascript
const handleApplyJob = (jobId) => {
  navigate(`/jobs/${jobId}`);  // Routes to JobDetail page
};
```

---

## 7. User Profile Pages

### Profile Architecture

#### Route Pattern
```javascript
/profile/:userId  (visited profile)
/profile or /auth/profile (own profile, requires auth)
```

#### Implementation (client/src/pages/Profile.jsx)

**Props**:
```javascript
isAdminView = false  // Admin dashboard viewing user profile
```

**State**:
```javascript
profile (merged from User + role-specific profile),
employerStats (for employer view),
loading, edit mode flags
```

**Profile Data Structure**:
```javascript
// Merged from User model + role-specific profile
{
  ...userData,
  // For employers: businessAddressStructured (from EmployerProfile.businessAddress)
  // For jobseekers: presentAddress, permanentAddress (structured)
  ...profileData
}
```

**Jobseeker Profile Fields Displayed**:
- Civil status, date of birth, gender
- Phone, email
- Present/Permanent addresses (structured as street, barangay, municipality, province)
- Employment status, unemployment reason
- Certifications, skills, experience summary

**Employer Profile Fields Displayed**:
- Company name, industry, size, website
- Business address (structured)
- Owner/contact person info
- Verification status
- Active job count, total applicants, closed jobs

#### Role-Based Rendering
```javascript
const isEmployer = profile?.role === "employer";
const isAdmin = profile?.role === "admin";
const isReadOnly = isAdminView;
```

**Admin View** (isAdminView=true):
- Fetches from `adminAPI.getUserById(userId)` 
- Returns `{ user, profile, stats }`
- Shows employment statistics for employers

**User Own View**:
- Fetches from `authAPI.getProfile()`
- Shows edit form

---

## 8. Pagination Patterns

### Pattern 1: Admin Users List (adminController.js)

```javascript
exports.getAllUsers = async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
  
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 })
  ]);

  return res.json({
    users,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    currentPage: page
  });
};
```

**Response Format**:
```json
{
  "users": [...],
  "total": 150,
  "totalPages": 8,
  "currentPage": 1
}
```

### Pattern 2: Notification API (notificationController implied)
- Supports query params: `page`, `limit`
- Called via `notificationAPI.getNotifications(params)`

### Pattern 3: Employer Ranked Applicants
```javascript
employerAPI.getRankedApplicants(jobId, params = {})
// Supports params but implementation may handle pagination server-side
```

### Current Gaps
❌ **JobBoard** - No pagination, loads all jobs into memory  
❌ **Message list** - No pagination visible in messageAPI  
⚠️ **Inconsistent** - Only admin panel and notifications seem to support full pagination

---

## 9. Socket.IO Integration

### Connection Setup (server/server.js)

**Socket URL**:
```javascript
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";
```

**Server Configuration**:
```javascript
new Server(server, {
  cors: { origin: (fn), credentials: true, methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
  allowEIO3: true
})
```

### Authentication Middleware
```javascript
io.use((socket, next) => {
  const token = socket.handshake.auth.token;  // From client auth config
  if (!token) return next(new Error("Authentication required"));
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});
```

### User-Specific Room Naming
**Pattern**: `user:${String(socket.userId)}`

```javascript
io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.userId}`);
  
  // Join user-specific notification room
  socket.join(`user:${String(socket.userId)}`);
  
  // Track user connections
  if (!userConnections.has(socket.userId)) {
    userConnections.set(socket.userId, new Set());
  }
  userConnections.get(socket.userId).add(socket.id);
});
```

### Conversation-Specific Rooms
**Pattern**: `${conversationId}` (MongoDB ObjectId string)

```javascript
socket.on("join_conversation", (conversationId) => {
  if (!conversationId || !/^[a-fA-F0-9]{24}$/.test(conversationId)) {
    return socket.emit("error", { message: "Invalid conversation ID" });
  }
  socket.rooms = socket.rooms || new Set();
  socket.rooms.add(conversationId);
  socket.join(String(conversationId));
  console.log(`📩 User ${socket.userId} joined conversation: ${conversationId}`);
});
```

### Event Patterns

**Messaging Events**:
- `send_message`: Broadcast to conversation room
- `join_conversation`: Join specific conversation room
- `leave_conversation`: Leave conversation room
- `typing`: Broadcast to conversation room
- `stop_typing`: Broadcast to conversation room

**Broadcasting**:
```javascript
socket.on("send_message", async (data = {}) => {
  // Validation...
  const message = await Message.create({...});
  
  // Emit to conversation participants
  io.to(String(conversationId)).emit("new_message", {
    id: message._id,
    conversationId,
    sender: {...},
    content: sanitizedContent,
    timestamp: new Date()
  });
});
```

**Rate Limiting**:
```javascript
const messageCounts = new Map();  // Track per user
const rateLimitInterval = setInterval(() => {
  messageCounts.set(socket.userId, 0);
}, 60000);  // Reset every minute
```

---

## 10. Authentication Patterns

### JWT Structure (authController.js)

**Payload**:
```javascript
jwt.sign(
  { id: user._id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: "30d" }
)
```

**Token Storage** (client):
```javascript
localStorage.setItem("token", token);
localStorage.setItem("user", JSON.stringify(user));
localStorage.setItem("tokenExpiry", (Date.now() + 30 * 24 * 60 * 60 * 1000).toString());
```

### Verification Middleware (server/middleware/auth.js)

```javascript
exports.verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select("isActive role verificationStatus");
    
    if (!user || user.isActive === false) {
      return res.status(403).json({ message: "User not found or deactivated" });
    }
    
    req.user = {
      ...decoded,
      role: user.role,
      verificationStatus: user.verificationStatus
    };
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid token" });
  }
};
```

### Role-Based Access Control (RBAC) Middleware

**Middleware Functions**:
```javascript
isResident()  // Allows: resident, employee, jobseeker
isEmployee()  // Allows: employee only
isEmployer()  // Allows: employer only
isVerifiedEmployer()  // Allows: employer + verification status === "verified"
isEmployeeOrResident()  // Allows: resident, employee, jobseeker
isAdmin()  // Allows: admin only
```

**Role Normalization**:
```javascript
// In auth middleware, "employee" and "jobseeker" are normalized to "resident"
// This is done to maintain backward compatibility with legacy role names
```

### Verification Status Checks
**For Employer Actions**:
```javascript
exports.isVerifiedEmployer = (req, res, next) => {
  if (req.user.role !== "employer") {
    return res.status(403).json({ message: "Only employers can perform this action" });
  }
  if (req.user.verificationStatus !== "verified") {
    return res.status(403).json({ 
      message: "Your employer account is not yet verified. Please upload your business permit and wait for admin approval."
    });
  }
  next();
};
```

**Verification Flow**:
1. Employer registers → `verificationStatus: "pending"`
2. Employer uploads business permit
3. Admin reviews and updates to `"verified"` or rejects
4. Only verified employers can post jobs and view rankings

### Request/Response Flow
```
Client Request
  ↓ (with Authorization header)
Express Server
  ↓
verifyToken() middleware
  ↓ (parses token, fetches user from DB)
req.user = { id, role, verificationStatus }
  ↓
Role-specific middleware (e.g., isVerifiedEmployer)
  ↓
Route handler
  ↓
Response
```

### API Rate Limiting (server.js)
```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,     // 15 minutes
  max: 50,                        // 50 requests
  skipSuccessfulRequests: true
});

app.use(`/api/v1/auth/login`, authLimiter);
app.use(`/api/v1/auth/register`, authLimiter);
```

---

## Summary: What's Already Built vs. What Needs Building

### ✅ Existing (Ready to Use)

1. **Three-Role System**: resident, employer, admin with role normalization
2. **Structured Job Qualifications**: qualification arrays with type, value, order, optional flag
3. **Semantic Job Matching**: `/recommendations/jobs` endpoint (semantic search implemented)
4. **Real-time Messaging**: Socket.IO with user-specific rooms (`user:{userId}`)
5. **Admin Dashboard**: Full user/job management with pagination
6. **Application Tracking**: JobApplication model tracks status (pending, reviewed, shortlisted, rejected, hired)
7. **Employer Ranking System**: Ranked applicants with scoring
8. **Notification System**: User notifications stored in User model and separate Notification collection
9. **File Upload Pipeline**: Profile images, resumes, business permits with categorized storage
10. **Security**: Helmet, CORS, rate limiting, JWT auth, SQL injection prevention

### ❌ Needs to Be Built (For Social Features)

1. **User Following/Followers System**
   - Would require: `followers[]`, `following[]` arrays in User model
   - Or separate `UserFollowship` collection

2. **Job Likes/Favorites**
   - Would require: `likes[]` array in JobVacancy
   - Or separate `JobLike` collection with (userId, jobId, timestamp)

3. **User Profiles with Social Engagement**
   - Currently: Profile is form-based (name, company, contact info)
   - Missing: Feed/timeline, user bio rich text, social media links, follower count display

4. **Engagement Metrics**
   - View counts on jobs (currently not tracked)
   - Job share count
   - Applicant feedback/ratings

5. **Search/Discovery Enhancements**
   - User search by name/company (partially exists in messageController)
   - Job search UI (exists but limited UI)
   - Saved searches functionality

6. **Recommendation Engine Fine-tuning**
   - Currently: Semantic matching via `/recommendations/jobs`
   - Missing: "People you might know", "Jobs similar to liked ones"

### 🔧 Architecture Notes

- **No monolithic frontend state** - Pure Context API for auth, Socket.IO
- **Modular backend** - Separate controllers, models, routes, middleware, services
- **Feature separation**: JobseekerProfile and EmployerProfile keep role-specific data separate
- **Semantic layer**: Exists but not fully exposed in UI (uses `semanticService`)
- **Rate limiting strategy**: Global + auth-specific + admin-specific + upload-specific
- **Upload isolation**: Separate directories for profiles, jobs, resumes, temp files

---

## File Structure Reference

| Category | File Path | Purpose |
|----------|-----------|---------|
| **Models** | `server/models/User.js` | Core user (resident, employer, admin) |
| | `server/models/JobVacancy.js` | Job listings with qualifications |
| | `server/models/JobApplication.js` | Application tracking |
| | `server/models/JobseekerProfile.js` | Jobseeker extended profile |
| | `server/models/EmployerProfile.js` | Employer extended profile |
| | `server/models/Conversation.js` | User-to-user messaging |
| | `server/models/Message.js` | Individual messages |
| **Controllers** | `server/controllers/authController.js` | Registration, login, profile |
| | `server/controllers/jobController.js` | Job CRUD & applications |
| | `server/controllers/employerController.js` | Employer-specific job management |
| | `server/controllers/adminController.js` | Admin user/job management |
| | `server/controllers/messageController.js` | Conversation & messaging |
| | `server/controllers/notificationController.js` | User notifications |
| **Middleware** | `server/middleware/auth.js` | JWT verification & RBAC |
| | `server/middleware/upload.js` | File upload handling |
| | `server/middleware/security.js` | Malicious payload detection |
| | `server/middleware/validation.js` | Input sanitization |
| **Frontend** | `client/src/pages/JobBoard.jsx` | Job search & apply |
| | `client/src/pages/Profile.jsx` | User profile view |
| | `client/src/pages/EmployerDashboard.jsx` | Employer job/applicant management |
| | `client/src/pages/AdminDashboard.jsx` | Admin panel |
| | `client/src/context/AuthContext.jsx` | Auth state |
| | `client/src/context/SocketContext.jsx` | Real-time Socket.IO state |
| | `client/src/services/api.js` | All API endpoints |
| **Styles** | `client/src/styles/*.css` | Component-specific styling |

---

## Recommendations for Building Social Features

### If adding followers/following:
1. Create `UserFollow` model: `{ followerId, followingId, followedAt }`
2. Add to User: `followerCount`, `followingCount` (denormalized for performance)
3. Add endpoints: `POST /users/{id}/follow`, `DELETE /users/{id}/unfollow`
4. Add Socket.IO event: `new_follower` → emit to `user:{userId}`

### If adding job likes/favorites:
1. Create `JobFavorite` model: `{ userId, jobId, likedAt }`
2. Denormalize: Add `likeCount` to JobVacancy
3. Add endpoints: `POST /jobs/{id}/like`, `DELETE /jobs/{id}/unlike`
4. Update JobBoard to show "Liked by X people"

### Icon library strategy:
- Already using React Icons (Font Awesome) - no need to change
- Can add: `FaHeart`, `FaHeartEmpty`, `FaUserPlus`, `FaUserCheck` for social actions

---

## End of Report
