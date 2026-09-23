# STRAMPESO

STRAM-PESO is a full-stack job platform with role-based workflows for residents (job seekers), employers, and admins.

## Submission Checklist

1. Project Title and Team Members
   - Project Title: STRAM-PESO
   - Team Members: Ivy P. Cruzado, Alexis M. Echon, Alkimar S. Guitang, Jake Romar I. Sescar
2. Link to the Live Frontend Web Application
   - https://strampeso.vercel.app/
3. Link to the Live Backend API
   - https://stram-peso.onrender.com
4. - API Documentation: **see** ./STRAM-PESO.pdf
5. - Part 1 Proposal Document: **see** ./STRAM-PESO.pdf

## Live Deployment

- Frontend: https://strampeso.vercel.app/
- Backend API: https://stram-peso.onrender.com

## Tech Stack

### Frontend (`client`)
- React 19 + Vite
- React Router
- Axios
- Socket.IO Client
- Recharts
- html2canvas + jsPDF

### Backend (`server`)
- Node.js + Express 5
- MongoDB + Mongoose
- JWT authentication
- Multer uploads
- Socket.IO

## Repository Structure

- `client`: React frontend (Vite)
- `server`: Express API + Socket.IO server
- `server/uploads`: uploaded files (resumes, IDs, documents)
- `postman`: Postman collection

## User Roles

- `resident`: job seeker
- `employer`: job poster / applicant manager
- `admin`: system management and moderation

## Core Features

- Authentication and role-based authorization
- Job posting, browsing, and applications
- Employer applicant tracking and status updates
- Admin analytics and user management
- Real-time messaging with conversation threads
- Profile and onboarding management

## API Base URLs

Routes are mounted in both namespaces:

- `/api/v1` (current)
- `/api` (backward-compatible)

Local default base URL used by frontend in development:

- `http://localhost:3000/api/v1`

## API Routes (Current)

### Auth
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /auth/profile`
- `PUT /auth/profile`
- `PATCH /auth/me`
- `DELETE /auth/profile`
- `POST /auth/register/employer`
- `POST /auth/invite` (admin)
- `PATCH /auth/promote/:userId` (admin)

### Jobs
- `GET /jobs` (authenticated)
- `GET /jobs/mine` (employer)
- `GET /jobs/applications/me` (resident)
- `PUT /jobs/applications/:id` (resident)
- `DELETE /jobs/applications/:id` (resident)
- `POST /jobs` (employer)
- `POST /jobs/:id/apply` (resident)
- `GET /jobs/:id/applications` (authenticated)
- `GET /jobs/:id` (authenticated)
- `PUT /jobs/:id` (employer)
- `DELETE /jobs/:id` (employer)

### Employer
- `GET /employer/jobs`
- `POST /employer/jobs`
- `PUT /employer/jobs/:id`
- `DELETE /employer/jobs/:id`
- `GET /employer/jobs/:jobId/applicants`
- `PUT /employer/applications/:applicationId/status`
- `GET /employer/stats`
- `GET /employer/profile-stats`

### Messages
- `GET /messages/users/search`
- `POST /messages/conversations`
- `GET /messages/conversations`
- `GET /messages/conversations/:conversationId/messages`
- `POST /messages/conversations/:conversationId/messages`
- `DELETE /messages/conversations/:conversationId`
- `GET /messages/unread-count`

### Admin
- `GET /admin/analytics`
- `GET /admin/users`
- `PUT /admin/users/:id/role`
- `PUT /admin/users/:id/deactivate`
- `PUT /admin/users/:id/reactivate`
- `PUT /admin/users/:id/verification`
- `DELETE /admin/users/:id`

### Users
- `PUT /users/onboarding`

## Environment Variables

Create `server/.env`:

```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
CLIENT_ORIGINS=http://localhost:5173
ALLOW_VERCEL_PREVIEWS=false
```

Notes:
- If `PORT` is not set, the server falls back to `5000`.
- `CLIENT_ORIGINS` accepts a comma-separated list.
- Set `ALLOW_VERCEL_PREVIEWS=true` to allow `*.vercel.app` preview origins.

## Local Development

Use two terminals.

### Backend
```bash
cd server
npm install
npm run dev
```

### Frontend
```bash
cd client
npm install
npm run dev
```

Defaults:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000` (or `http://localhost:5000` if `PORT` is unset)

## Root Scripts

From repository root (`package.json`):

- `npm run install:client` installs frontend dependencies
- `npm run build` installs frontend deps and builds `client`
- `npm run preview` runs frontend preview from `client`
- `npm run test` runs Jest with coverage

## Backend Scripts

From `server/package.json`:

- `npm run dev` starts nodemon
- `npm start` starts server with Node
- `npm test` runs tests (`--passWithNoTests`)
- `npm run test:coverage` runs tests with coverage

## File Upload Notes

- Upload directory: `server/uploads`
- Size limit: 10MB
- Supported types across routes include: `pdf`, `doc`, `docx`, `jpeg`, `jpg`, `png` (plus `gif` in server-level multer config)



