# HR Signal AI — Complete Build Plan

## Context

The workspace is a fresh Vite + React 19 + TypeScript + Tailwind + shadcn/ui template. There is **no backend configured** (no database, auth, storage, or backend functions). The task is to build **HR Signal AI**, a complete enterprise workforce decision-intelligence platform, end to end: frontend, database, auth, role-based permissions, storage, backend business logic, realtime, audit, workflows, demo seed data, testing, and deployment — all on EnterPro native capabilities.

Every major interface must be connected to persistent Enter Cloud data with verified frontend→backend→database flows. The app has exactly two roles (Founder/CEO, HR) and ~24 protected routes plus `/login`.

## Phase 0 — Enable Enter Cloud backend

Call `supabase_enable` (first implementation step; requires user approval in dialog). Everything below depends on it. After it connects: inspect existing tables (must preserve any pre-existing data), verify generated client at `src/integrations/supabase/client.ts` (framework-generated — do not edit; use it or a thin wrapper `src/lib/db.ts` if the file does not exist).

- [ ] `supabase_enable` → Enter Cloud on
- [ ] Confirm generated supabase client + env wiring exists; set up `src/lib/db.ts` client re-export if needed
- [ ] Never mention "Supabase" to the user — always "Enter Cloud"; backend functions = "backend functions"

## Phase 1 — Database schema (one migration per logical group)

All tables: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` timestamps, RLS **enabled in the same migration that creates the table**, `updated_at` trigger, indexes on FK/code/email/date/status columns. No raw SQL in functions. Tables named `hr_*` (new business namespace; do not touch any pre-existing tables).

1. **hr_profiles** — user_id (→ auth.users), full_name, email, role (`founder`|`hr` CHECK), avatar_url, phone, is_active, last_login_at
2. **hr_departments** — code UNIQUE, name, description, head_employee_id, capacity, is_active, created_by
3. **hr_employees** — code UNIQUE, full_name, work_email, personal_email, phone, avatar_url, department_id FK, manager_id FK, job_title, employment_type, work_mode, location, joining_date, exit_date, status, skills; partial unique on work_email
4. **hr_attendance_imports** — file_name, file_path, file_type, uploaded_by, status, total_rows, valid_rows, invalid_rows, duplicate_rows, confirmed_at, failure_reason
5. **hr_attendance_import_rows** — import_id FK, row_number, raw_values jsonb, employee_code, attendance_date, validation_status, validation_errors jsonb, attendance_id FK
6. **hr_attendance** — employee_id FK, attendance_date, check_in, check_out, working_minutes, overtime_minutes, status, import_source, notes; **UNIQUE(employee_id, attendance_date)** — duplicate prevention; index on (date), (department via employee)
7. **hr_tasks** — employee_id, department_id, title, description, assigned_by, due_date, completed_date, priority, status, completion_percent
8. **hr_performance_reviews** — employee_id, department_id, reviewer_id, period_start, period_end, performance_score, goal_score, task_score, manager_rating, comments, status (draft|submitted|acknowledged|closed)
9. **hr_job_requisitions** — department_id, job_title, description, employment_type, openings, recruiter_id, status, open_date, target_close_date, close_date
10. **hr_candidates** — requisition_id, full_name, email, phone, resume_path, source, current_stage, status, applied_date, recruiter_id, rating, notes, linked_employee_id; indexes on stage/status/requisition
11. **hr_interviews** — candidate_id, interview_type, interviewer_id, scheduled_at, completed_at, rating, feedback, recommendation, status
12. **hr_internships** — candidate_id, employee_id, department_id, start_date, planned_end_date, actual_end_date, supervisor_id, status, evaluation, conversion_decision
13. **hr_signals** — entity_type (employee|department), entity_id, signal_type, score, severity, formula_version, evidence jsonb, explanation, evidence_quality, status, detected_at, reviewed_by, reviewed_at; index on severity/type/entity
14. **hr_ai_insights** — scope, entity_type, entity_id, category, title, summary, verified_evidence jsonb, limitations, recommendation, confidence, generated_at, dismissed_at
15. **hr_ai_conversations** — creator_id, title, context_type, context_entity_id; **hr_ai_messages** — conversation_id, sender_type, message, evidence_refs jsonb
16. **hr_actions** — title, description, source_type, source_ref, priority, assigned_to, created_by, due_date, status, sensitivity, approval_required, resolution_notes
17. **hr_approvals** — action_id, requested_by, approver_id, decision, decision_notes, requested_at, decided_at; index on status/action
18. **hr_workflow_events** — action_id, event_type, previous_state, new_state, triggered_by, metadata jsonb
19. **hr_audit_log** — actor_id, entity_type, entity_id, action, before_json jsonb, after_json jsonb, session_meta jsonb
20. **hr_notifications** — user_id, title, body, type, entity_type, entity_id, read_at (in-app; avoids spam by batching per event)

- [ ] RLS policies on every table: `hr` role = full CRUD on business tables; `founder` role = read-only on business tables + full on `hr_approvals`/read `hr_notifications`; both roles read `hr_profiles` (active); own-notifications-only policies
- [ ] `ALTER PUBLICATION supabase_realtime ADD TABLE` for: hr_employees, hr_departments, hr_attendance, hr_tasks, hr_performance_reviews, hr_candidates, hr_internships, hr_signals, hr_actions, hr_approvals, hr_workflow_events, hr_notifications
- [ ] Verify each table with schema check (RLS + policies actually present)

## Phase 2 — Authentication

- [ ] `supabase_configure_auth`: email/password only, **no public signup** (disable new-user registration), no social, auto-confirm emails on
- [ ] Backend function `create-demo-users` (admin API, idempotent): creates `founder@hrsignal.demo` (role founder) and `hr@hrsignal.demo` (role hr); passwords read from secrets via `Deno.env.get()` (see Phase 3 secrets); inserts hr_profiles rows; no password ever in frontend source or visible product
- [ ] `src/lib/auth.tsx` — AuthProvider using `supabase.auth.onAuthStateChange` (register listener before initial session check; never async callback; defer client calls with `setTimeout(...,0)`; keep user + session); loads hr_profiles row
- [ ] `src/lib/guards.tsx` — `RequireAuth` (redirect `/login`), `RequireRole` (HR vs Founder), role-based redirect component at `/` (founder→`/executive`, hr→`/dashboard`), logout
- [ ] `/login` page: email+password, remember-me, show/hide password, invalid-credentials error, loading state; no registration UI; branded "HR Signal AI"

## Phase 3 — Backend functions (Enter Cloud)

Secrets via `supabase_add_secret`: `DEMO_FOUNDER_PASSWORD`, `DEMO_HR_PASSWORD` (user pastes values; never in code). Functions at `supabase/functions/<name>/index.ts`, `Deno.serve`, full CORS + OPTIONS preflight, third-party imports from esm.sh, deployed with deploy tool, invoked via `supabase.functions.invoke`.

- [ ] **`seed-demo-data`** — idempotent (checks existing employee count; no-op if seeded): 7 departments (Engineering, Product, Marketing, Sales, Finance, Operations, People/HR), ~150 employees with managers, statuses (incl. exited), work modes (onsite/remote/hybrid), locations, skills; attendance across ~90 days (healthy + low-attendance examples, lates, absences, leaves) + a few attendance imports; tasks; performance reviews (strong + declining examples); requisitions (2–3 open), candidates at every stage incl. internship + full-time conversions; signals (attendance/performance/combined/task/attrition/recruitment-capacity risks, all severities incl. high/critical); AI insights; recommendations; actions incl. one pending approval; workflow events; audit entries; notifications
- [ ] **`attendance-import`** — multi-step (parse → preview → confirm), one responsibility per invocation via `action` field:
  - upload: validate extension (csv/xlsx/xls/text-PDF), size; store file in storage bucket `hr-attendance-imports`; create import record
  - parse: CSV (papaparse), XLS/XLSX (xlsx on esm.sh), text-based PDF (pdf-parse/pdfjs: extract text; **reject image-only PDFs gracefully** with clear message "export CSV/XLSX or text-based PDF"); detect header; map columns; validate employee codes against hr_employees, dates/times, missing fields, duplicates vs. file + existing DB; separate valid/invalid rows into hr_attendance_import_rows (**never final attendance before confirmation**)
  - confirm: transactional insert of valid rows into hr_attendance (skips duplicates idempotently — repeated confirm does not duplicate), updates import record + analytics + audit; writes notification
- [ ] **`risk-engine`** — versioned deterministic calc (`formula_version = 'risk-v1'`): attendance risk (attendance rate/absences/lateness), performance risk (scores/trends), combined = attendance 40% + performance 40% + task/goal trend 20%, task-completion risk, attrition risk (status/exits/engagement), recruitment-capacity risk (openings vs candidates/stage). Severity: low 0–34, medium 35–59, high 60–79, critical 80–100. Stores signals + evidence snapshot + explanation + recommendation + evidence_quality; "Insufficient data" when evidence insufficient; never makes hiring/rejection/disciplinary decisions. Backend is the authoritative calculator — frontend only displays.
- [ ] **`candidate-transition`** — validate stage transitions (Applied→Screening→Interview→Internship→Full-time Offer→Hired; internship separate from interview); request confirmation; transactional + **idempotent**; on Internship: create-or-link intern employee (employment_type=Intern, unique code), link candidate↔internship↔employee; on Hired: update the **same** employee to Full-time (never duplicate); preserves interview/internship/offer/conversion history; audit + workflow event + notification
- [ ] **`action-workflow`** — create action from risk/recommendation; assign owner; set priority/due date; request approval (sensitive actions) → creates hr_approvals + notifies founder; founder approve/reject → updates action, returns decision to HR; begin work, resolve/fail; validates every state transition on the backend; transactional; idempotent; writes hr_workflow_events + hr_audit_log + notifications
- [ ] **`ask-hr-signal`** — database-grounded deterministic assistant: intent matching over stored data (e.g., "why is X high risk", "lowest attendance department", "which employees need review", "candidates in Interview", "which actions require approval"); returns answer + evidence chips linking records; respects role permissions; returns "Insufficient data" state; never invents values; distinguishes facts from recommendations; persists to hr_ai_conversations/hr_ai_messages
- [ ] **`recompute`** (optional sweep) — recompute signals/insights on demand after big imports; idempotent
- [ ] Deploy all functions; verify logs on first invocation

## Phase 4 — Storage

- [ ] Buckets: `hr-attendance-imports` (uploaded attendance files; HR only), `hr-resumes` (candidate resumes; HR only). RLS policies scoped by role; file validation on upload; store public/private paths in DB records, never client-visible secrets

## Phase 5 — Design system & reusable UI

- [ ] Extend `src/index.css` + `tailwind.config.ts`: brand tokens — indigo primary, violet (insights), cyan (workflow), emerald (healthy), amber (warning), rose (critical/destructive); neutral slate surfaces; chart palette; typography scale; 8px spacing; radius/border/shadow tokens; focus/hover/disabled/loading states; deep navy sidebar; subtle gradients only in brand/insight areas
- [ ] Core shadcn components already present (button, dialog, sheet, drawer, tabs, table, badge, avatar, tooltip, dropdown, select, checkbox, switch, skeleton, toast/sonner, etc.) — customize variants (e.g., button `premium`, status badges)
- [ ] New shared components under `src/components/`: `page-header`, `section-header`, `kpi-card`, `chart-card`, `table-container`, `data-table` (sort/filter/pagination), `status-badge`, `risk-badge`, `severity-badge`, `empty-state`, `error-state`, `skeleton-states`, `search-input`, `filters` (date range, multi-select), `file-uploader`, `import-preview`, `validation-table`, `employee-card`, `candidate-card`, `insight-card`, `recommendation-card`, `action-card`, `confirm-dialog`, `notifications-popover`, `global-search`, `brand-logo` — one lucide-react icon family, no emoji
- [ ] **Shared Employee 360°** (`src/components/employee360/`): single reusable drawer, opened from Workforce, Attendance, Performance, Risk, Insights, Action Center, Executive HR Team via context or query param; tabs: Overview, Attendance, Tasks, Performance, Risk Evidence, Insights, Action History — all DB-connected; no per-module duplicate profiles

## Phase 6 — App shells, routing, auth wiring

- [ ] Centralized routes in `src/router.tsx` with `RequireAuth`/`RequireRole` wrappers (data-driven nav config shared between shells)
- [ ] **HR shell** (`src/layouts/hr-layout.tsx`): collapsible desktop sidebar (brand + "Add / Upload Data" quick action + expandable groups: Overview, Attendance, Performance [Departments, Employees], Workforce [Employees, Departments, Employee Status, Work Mode, More Analytics], Recruitment, AI Insights [Organization, Risk Monitor, Recommendations, Ask HR Signal], Action Center, Help & Support, Settings, Profile, Logout), top header (global search, notifications, department filter, date filter, profile), mobile drawer
- [ ] **Executive shell** (`src/layouts/exec-layout.tsx`): executive sidebar (Overview, HR Team, Workforce Health, AI Insights, Approvals, Settings), header (search, notifications, profile), mobile nav, read-focused
- [ ] Login page, role-based redirect, protected routes (unauthenticated → `/login`)

## Phase 7 — Feature pages (all DB-connected, all states: loading/skeleton/empty/error/partial/success/disabled/denied)

1. `/dashboard` (HR overview): KPIs (employees, departments, active/exited, attendance rate, avg performance, open positions, active candidates, high-risk employees, departments needing attention, pending actions/approvals) + charts (attendance trend, performance trend, recruitment funnel, workforce composition, department health, priority risks, pending actions, recent imports); every KPI drills down; filters (date, department, status, work mode, location)
2. Workforce: `/workforce/employees` (directory: search/sort/pagination, department/status/work-mode/employment-type/location filters, add/edit/view/exit employee, validations, confirm dialogs, CRUD + realtime), `/workforce/departments` (directory, create/edit, details: head, capacity, totals, attendance/performance health, open requisitions), `/workforce/status` (Active/Notice period/On leave/Exited + exit-date filters 30d/3m/6m/12m/custom), `/workforce/work-mode` (onsite/remote/hybrid distributions by dept & location), `/workforce/analytics`
3. Attendance: `/attendance` — dashboard (present/absent/late/on leave today, overall rate, trend, dept comparison, employee table, exceptions, low-attendance employees) + **import center** (upload CSV/XLS/XLSX/text-PDF, backend parse, column mapping, validation errors, preview valid/invalid/duplicate rows, correct/replace, confirm in transaction, import history + errors, audit)
4. Performance: `/performance/departments` (score, trend, goal achievement, task completion, review completion, distribution, employees needing review), `/performance/employees` (score, previous score, trend, goal, task completion, period, reviewer, status, Employee 360 link; create/save draft/edit/submit reviews, comments, history; attendance shown as context only — never auto-reduces performance)
5. Recruitment: `/recruitment` — summary, requisition CRUD (dept/job filters), candidate search, candidate Kanban + table, candidate detail drawer, interview timeline, internship details, offer state, conversion history; stage transitions via `candidate-transition` (validated + confirmed + audited + realtime)
6. Insights: `/insights/organization` (verified patterns across modules), `/insights/risks` (severity/type/dept/employee filters; risk table/cards; evidence drawer; Employee 360; create-action), `/insights/recommendations` (evidence, reason, scope, next step, limitations, Create Action), `/insights/ask` (suggested questions, conversation history, context selection, evidence chips, loading/failure states, new conversation, clear history)
7. Action Center: `/actions` — queue, filters, assignment, comments, evidence links, workflow timeline, approval state, resolution evidence, audit; create-from-risk/recommendation, request approval, sensitive vs routine
8. Executive: `/executive` (overview: headcount, active/exited, dept health, attendance/performance trend, recruitment health, critical risks, strategic recommendations, pending approvals, active actions), `/executive/hr-team` (team members, assigned/completed/overdue actions, recruitment ownership, import responsibility, workflow completion, profile drill-down), `/executive/workforce-health` (headcount movement, attrition, dept health, attendance health, performance distribution, work-mode distribution, capacity risk), `/executive/insights` (verified risks/recommendations/evidence/limitations), `/executive/approvals` (review request + evidence, open profiles, approve/reject with notes, workflow + audit history)
9. `/help`, `/settings` (both shells): profile info, role, session; preferences (localStorage only for harmless prefs like sidebar collapsed)
10. Realtime subscriptions refresh: workforce counts, attendance analytics, performance summaries, recruitment funnel, candidate stages, risks, actions, approvals, notifications
11. Notifications (in-app): import completion/failure, critical risk, assigned action, approval request/decision, overdue action, candidate conversion — batched to avoid spam; bell popover with unread count

## Phase 8 — Audit & security wiring

- [ ] Server-side authorization for: approval decisions, candidate transitions, attendance confirmation, action state changes, exit-marking (backend/RLS enforced — never frontend-only)
- [ ] Audit events on: login (where supported), employee create/edit/exit, import create/confirm/fail, review submit, candidate stage change, conversion, action state change, approval decision; before/after snapshots where meaningful
- [ ] RLS + backend double-check; safe error messages (no internal details); no secrets in client; no unauthorized cross-role access

## Phase 9 — Build & verification

- [ ] `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm run build` — fix all errors
- [ ] End-to-end journeys (see acceptance list in request §29): auth (both logins, invalid password, route protection, session persistence, logout), employee CRUD→360→exit→audit, attendance import (CSV/XLSX/text-PDF; image-only PDF rejected; invalid code/duplicate/missing date; repeated confirm no duplicates), performance (draft→submit→aggregate; attendance separate), recruitment (requisition→candidate→screening→interview→internship [intern employee created]→offer→hired [same employee updated, no duplicate]), risk (formula + severity + evidence), actions→approval (request→founder approve/reject→HR view updates→workflow+audit), Ask HR Signal (supported Q, evidence, permissions, insufficient-data)
- [ ] Realtime check: change in one view reflects in another without reload
- [ ] Responsive + accessibility: 1440/1024/768/390/320px, sidebar collapse, mobile drawer, tables usable, no horizontal overflow, keyboard nav, focus, dialogs (Escape, trap), touch targets, reduced-motion, contrast; charts with text summaries
- [ ] Console errors check; all routes render; no blank pages

## Phase 10 — Deployment

- [ ] Final lint/type/build; one-click EnterPro deployment (publish)
- [ ] Test the deployed URL: both roles login, protected routes stay protected in production, key workflows (attendance import, approval flow) run against production database

## Verification checklist

- [ ] Both roles log in with the two demo accounts and land on correct default routes
- [ ] HR can CRUD employees/departments; Founder cannot mutate (backend enforced)
- [ ] Attendance import end-to-end with CSV; duplicate re-confirm produces no duplicates
- [ ] Image-only PDF rejected with graceful message; text PDF parses
- [ ] Intern→hire conversion reuses the same employee row (no duplicate employee)
- [ ] Combined risk formula matches spec weights and severity bands (backend authoritative)
- [ ] Sensitive action requires Founder approval; approval updates HR view + audit
- [ ] Ask HR Signal answers from stored data with evidence; insufficient-data state when required
- [ ] Realtime refresh works across views; notifications delivered without spam
- [ ] No page-level horizontal overflow at 320–1440px; keyboard/dialog a11y pass
- [ ] `pnpm lint` + `tsc --noEmit` + production build green
- [ ] Deployed app verified: protected routes protected, workflows functional

## Files to create/modify (primary)

- Backend: `supabase/functions/{seed-demo-data,attendance-import,risk-engine,candidate-transition,action-workflow,ask-hr-signal,create-demo-users}/index.ts`, `supabase/config.toml`
- Database: migration files via Enter Cloud migration tool (tables, RLS, indexes, realtime publication)
- Frontend: `src/lib/{db.ts,auth.tsx,guards.tsx,types.ts,permissions.ts,risk.ts(display-only),nav.ts}`, `src/layouts/{hr-layout,exec-layout}.tsx`, `src/components/{shared UI library, employee360/}`, `src/pages/{login,dashboard,attendance,performance/*,workforce/*,recruitment,insights/*,actions,help,settings,executive/*}`
- Design: `src/index.css`, `tailwind.config.ts`, `index.html` (title "HR Signal AI")

## Known constraints

- No external AI provider: risk engine + Ask HR Signal are deterministic backend logic over stored data (matches request §17–18)
- No public signup; demo users created server-side; passwords only via secrets
- All decisions (approval, conversion, confirmation) enforced in backend functions + RLS, never frontend-only
