/**
 * Domain types and label maps for HR Signal AI.
 *
 * These mirror the database schema. Risk scores are only ever *displayed* here —
 * the authoritative calculation lives in the risk-engine backend function.
 */

export type Role = "founder" | "hr";

export type EmployeeStatus = "active" | "notice period" | "on leave" | "exited";
export type WorkMode = "onsite" | "remote" | "hybrid";
export type EmploymentType = "intern" | "full-time" | "part-time" | "contract";
export type AttendanceStatus = "present" | "absent" | "late" | "half-day" | "leave" | "holiday";
export type CandidateStage = "applied" | "screening" | "interview" | "internship" | "full_time_offer" | "hired";
export type CandidateStatus =
  | "active"
  | "on_hold"
  | "rejected"
  | "withdrawn"
  | "offer_declined"
  | "internship_completed_not_converted";
export type SignalType =
  | "attendance_risk"
  | "performance_risk"
  | "combined_risk"
  | "task_completion_risk"
  | "attrition_risk"
  | "recruitment_capacity_risk";
export type Severity = "low" | "medium" | "high" | "critical";
export type EvidenceQuality = "strong" | "moderate" | "limited" | "insufficient";
export type ActionStatus =
  | "new"
  | "under_review"
  | "approval_required"
  | "approved"
  | "rejected"
  | "in_progress"
  | "resolved"
  | "failed"
  | "dismissed";
export type Priority = "low" | "medium" | "high" | "critical";
export type Sensitivity = "routine" | "sensitive";
export type ApprovalDecision = "pending" | "approved" | "rejected";
export type ReviewStatus = "draft" | "submitted" | "acknowledged" | "closed";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "completed" | "cancelled";
export type RequisitionStatus = "draft" | "open" | "on_hold" | "closed" | "cancelled";
export type InterviewStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export interface HrProfile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  avatar_url: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  description: string | null;
  head_employee_id: string | null;
  capacity: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type TeamStatus = "active" | "archived";

export interface Team {
  id: string;
  department_id: string;
  name: string;
  team_code: string;
  description: string | null;
  capacity: number | null;
  team_lead_id: string | null;
  status: TeamStatus;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  code: string;
  full_name: string;
  work_email: string | null;
  personal_email: string | null;
  phone: string | null;
  avatar_url: string | null;
  department_id: string | null;
  manager_id: string | null;
  job_title: string | null;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  location: string | null;
  joining_date: string | null;
  exit_date: string | null;
  status: EmployeeStatus;
  skills: string[] | null;
  team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  working_minutes: number | null;
  overtime_minutes: number;
  status: AttendanceStatus;
  import_source: string | null;
  notes: string | null;
}

export interface AttendanceImport {
  id: string;
  file_name: string;
  file_path: string | null;
  file_type: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  status: "uploaded" | "parsed" | "preview_ready" | "confirmed" | "failed";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  confirmed_at: string | null;
  failure_reason: string | null;
  column_mapping: Record<string, unknown> | null;
  created_at: string;
}

export interface AttendanceImportRow {
  id: string;
  import_id: string;
  row_number: number;
  raw_values: Record<string, string>;
  employee_code: string | null;
  employee_id: string | null;
  attendance_date: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  validation_status: "valid" | "invalid" | "duplicate" | "pending";
  validation_errors: string[];
}

export interface Task {
  id: string;
  employee_id: string | null;
  department_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  completed_date: string | null;
  priority: Priority;
  status: TaskStatus;
  completion_percent: number;
}

export interface PerformanceReview {
  id: string;
  employee_id: string;
  department_id: string | null;
  reviewer_id: string | null;
  period_start: string;
  period_end: string;
  performance_score: number | null;
  goal_score: number | null;
  task_score: number | null;
  manager_rating: number | null;
  comments: string | null;
  status: ReviewStatus;
  created_at: string;
}

export interface Requisition {
  id: string;
  department_id: string | null;
  job_title: string;
  description: string | null;
  employment_type: EmploymentType;
  openings: number;
  recruiter_id: string | null;
  status: RequisitionStatus;
  open_date: string | null;
  target_close_date: string | null;
  close_date: string | null;
}

export interface Candidate {
  id: string;
  requisition_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  resume_path: string | null;
  source: string | null;
  current_stage: CandidateStage;
  status: CandidateStatus;
  applied_date: string;
  recruiter_id: string | null;
  rating: number | null;
  notes: string | null;
  linked_employee_id: string | null;
}

export interface Interview {
  id: string;
  candidate_id: string;
  interview_type: string;
  interviewer_id: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  rating: number | null;
  feedback: string | null;
  recommendation: string | null;
  status: InterviewStatus;
}

export interface Internship {
  id: string;
  candidate_id: string;
  employee_id: string | null;
  department_id: string | null;
  start_date: string;
  planned_end_date: string | null;
  actual_end_date: string | null;
  supervisor_id: string | null;
  status: "active" | "completed" | "terminated" | "converted";
  evaluation: string | null;
  conversion_decision: "pending" | "convert" | "not_converted" | null;
}

export interface Signal {
  id: string;
  entity_type: "employee" | "department";
  entity_id: string;
  signal_type: SignalType;
  score: number;
  severity: Severity;
  formula_version: string;
  evidence: Record<string, unknown>;
  explanation: string | null;
  evidence_quality: EvidenceQuality;
  limitations: string | null;
  recommendation: string | null;
  status: "new" | "reviewed" | "acknowledged" | "resolved" | "dismissed";
  detected_at: string;
}

export interface Insight {
  id: string;
  scope: "organization" | "department" | "employee";
  entity_type: "employee" | "department" | null;
  entity_id: string | null;
  category: string;
  title: string;
  summary: string;
  verified_evidence: Record<string, unknown>;
  limitations: string | null;
  recommendation: string | null;
  confidence: EvidenceQuality;
  generated_at: string;
  dismissed_at: string | null;
}

export interface HrAction {
  id: string;
  title: string;
  description: string | null;
  source_type: string;
  source_ref: string | null;
  priority: Priority;
  assigned_to: string | null;
  created_by: string | null;
  due_date: string | null;
  status: ActionStatus;
  sensitivity: Sensitivity;
  approval_required: boolean;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  action_id: string;
  requested_by: string | null;
  approver_id: string | null;
  decision: ApprovalDecision;
  decision_notes: string | null;
  requested_at: string;
  decided_at: string | null;
}

export interface WorkflowEvent {
  id: string;
  action_id: string;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  triggered_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  session_meta: Record<string, unknown>;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: "info" | "success" | "warning" | "critical" | "approval" | "action" | "import";
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  creator_id: string;
  title: string;
  context_type: "organization" | "department" | "employee";
  context_entity_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_type: "user" | "assistant";
  message: string;
  evidence_refs: Array<{ label: string; type: string; id: string }>;
  created_at: string;
}

/* ------------------------------------------------------------------ labels */

export const ROLE_LABELS: Record<Role, string> = {
  founder: "Founder/CEO",
  hr: "HR",
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  "notice period": "Notice period",
  "on leave": "On leave",
  exited: "Exited",
};

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  active: "Active",
  archived: "Archived",
};

export const TEAM_STATUS_TONE: Record<TeamStatus, Tone> = {
  active: "success",
  archived: "neutral",
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  onsite: "Onsite",
  remote: "Remote",
  hybrid: "Hybrid",
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  intern: "Intern",
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Contract",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  "half-day": "Half day",
  leave: "Leave",
  holiday: "Holiday",
};

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  internship: "Internship",
  full_time_offer: "Full-time Offer",
  hired: "Hired",
};

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  offer_declined: "Offer Declined",
  internship_completed_not_converted: "Internship Completed - Not Converted",
};

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  attendance_risk: "Attendance risk",
  performance_risk: "Performance risk",
  combined_risk: "Combined risk",
  task_completion_risk: "Task completion risk",
  attrition_risk: "Attrition risk",
  recruitment_capacity_risk: "Recruitment capacity risk",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const EVIDENCE_QUALITY_LABELS: Record<EvidenceQuality, string> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  limited: "Limited evidence",
  insufficient: "Insufficient data",
};

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  new: "New",
  under_review: "Under Review",
  approval_required: "Approval Required",
  approved: "Approved",
  rejected: "Rejected",
  in_progress: "In Progress",
  resolved: "Resolved",
  failed: "Failed",
  dismissed: "Dismissed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  closed: "Closed",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: "Draft",
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
  cancelled: "Cancelled",
};

/* ------------------------------------------------------------------ options */

export const EMPLOYEE_STATUS_OPTIONS = Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[];
export const WORK_MODE_OPTIONS = Object.keys(WORK_MODE_LABELS) as WorkMode[];
export const EMPLOYMENT_TYPE_OPTIONS = Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[];
export const CANDIDATE_STAGE_OPTIONS = Object.keys(CANDIDATE_STAGE_LABELS) as CandidateStage[];
export const CANDIDATE_STATUS_OPTIONS = Object.keys(CANDIDATE_STATUS_LABELS) as CandidateStatus[];
export const SIGNAL_TYPE_OPTIONS = Object.keys(SIGNAL_TYPE_LABELS) as SignalType[];
export const SEVERITY_OPTIONS: Severity[] = ["low", "medium", "high", "critical"];
export const ACTION_STATUS_OPTIONS = Object.keys(ACTION_STATUS_LABELS) as ActionStatus[];
export const PRIORITY_OPTIONS: Priority[] = ["low", "medium", "high", "critical"];
export const REVIEW_STATUS_OPTIONS = Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[];
export const REQUISITION_STATUS_OPTIONS = Object.keys(REQUISITION_STATUS_LABELS) as RequisitionStatus[];

/** Tone keys map to the semantic badge variants defined in the design system. */
export type Tone = "neutral" | "primary" | "insight" | "workflow" | "success" | "warning" | "critical" | "info";

export const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, Tone> = {
  active: "success",
  "notice period": "warning",
  "on leave": "info",
  exited: "neutral",
};

export const WORK_MODE_TONE: Record<WorkMode, Tone> = {
  onsite: "primary",
  remote: "insight",
  hybrid: "workflow",
};

export const EMPLOYMENT_TYPE_TONE: Record<EmploymentType, Tone> = {
  intern: "workflow",
  "full-time": "primary",
  "part-time": "neutral",
  contract: "warning",
};

export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, Tone> = {
  present: "success",
  absent: "critical",
  late: "warning",
  "half-day": "warning",
  leave: "info",
  holiday: "neutral",
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  low: "success",
  medium: "warning",
  high: "critical",
  critical: "critical",
};

export const ACTION_STATUS_TONE: Record<ActionStatus, Tone> = {
  new: "info",
  under_review: "workflow",
  approval_required: "warning",
  approved: "success",
  rejected: "critical",
  in_progress: "workflow",
  resolved: "success",
  failed: "critical",
  dismissed: "neutral",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "critical",
};

export const REVIEW_STATUS_TONE: Record<ReviewStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  acknowledged: "workflow",
  closed: "success",
};

export const CANDIDATE_STATUS_TONE: Record<CandidateStatus, Tone> = {
  active: "success",
  on_hold: "warning",
  rejected: "critical",
  withdrawn: "neutral",
  offer_declined: "critical",
  internship_completed_not_converted: "warning",
};

export const EVIDENCE_QUALITY_TONE: Record<EvidenceQuality, Tone> = {
  strong: "success",
  moderate: "info",
  limited: "warning",
  insufficient: "neutral",
};

export const REQUISITION_STATUS_TONE: Record<RequisitionStatus, Tone> = {
  draft: "neutral",
  open: "success",
  on_hold: "warning",
  closed: "neutral",
  cancelled: "critical",
};

/** Severity bands from the specification (applies to risk scores 0-100). */
export const RISK_BANDS: Array<{ label: string; min: number; max: number; severity: Severity }> = [
  { label: "Low", min: 0, max: 34, severity: "low" },
  { label: "Medium", min: 35, max: 59, severity: "medium" },
  { label: "High", min: 60, max: 79, severity: "high" },
  { label: "Critical", min: 80, max: 100, severity: "critical" },
];

export function severityFromScore(score: number): Severity {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export const COMBINED_RISK_WEIGHTS = { attendance: 0.4, performance: 0.4, taskTrend: 0.2 } as const;
