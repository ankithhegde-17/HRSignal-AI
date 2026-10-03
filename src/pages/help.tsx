import { BookOpen, ClipboardList, Gauge, ShieldCheck, Sparkles, UserCog, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ToneBadge } from "@/components/shared/badges";
import { ROLE_LABELS } from "@/lib/types";

const WORKFLOWS = [
  {
    icon: ClipboardList,
    title: "Attendance import",
    steps: [
      "Export the period from your biometric system as CSV, XLS or XLSX (text-based PDF also works).",
      "Upload it in Attendance → Import center. Columns are detected and mapped automatically.",
      "Review the staged rows: valid, invalid and duplicate are separated with the reason for each failure.",
      "Confirm. Only valid rows are written, and confirming twice never creates duplicates.",
    ],
  },
  {
    icon: Users,
    title: "Workforce management",
    steps: [
      "Departments and employees are the master data every other module references.",
      "Add or edit employees in Workforce → Employees; mark an exit to update analytics while keeping history.",
      "Anywhere an employee appears you can open the shared Employee 360° view for their full record.",
    ],
  },
  {
    icon: UserCog,
    title: "Performance reviews",
    steps: [
      "Create a review against an employee and review period, then save it as a draft.",
      "Submit the draft to publish the score to employee and department aggregates.",
      "Attendance is displayed as context only — it never automatically reduces a performance score.",
    ],
  },
  {
    icon: Sparkles,
    title: "Recruitment and conversion",
    steps: [
      "Department → requisition → candidate. Candidates always belong to a requisition.",
      "Move candidates through Applied, Screening, Interview, optional Internship, Full-time Offer and Hired.",
      "Entering Internship creates or links a single intern employee record.",
      "Hiring updates that same employee to full-time — no duplicate employee is ever created.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Risk, actions and approvals",
    steps: [
      "The backend risk engine scores attendance, performance, task completion, attrition and recruitment capacity.",
      "Combined risk weights attendance 40%, performance 40% and task/goal trend 20%; severity bands are 0–34, 35–59, 60–79, 80–100.",
      "Create an action from any risk or recommendation, assign an owner and a due date.",
      "Sensitive actions need Founder/CEO approval before work starts; every decision is recorded.",
    ],
  },
];

const FAQ = [
  {
    question: "Why does the assistant sometimes say “Insufficient data”?",
    answer:
      "Ask HR Signal only reports what is stored. If there is no review, no attendance history or no signal for the requested scope, it says so rather than estimating.",
  },
  {
    question: "Can a signal automatically reject or terminate someone?",
    answer:
      "No. Signals prioritise attention. Hiring, rejection, promotion, disciplinary action and termination always remain human decisions, and the platform records who decided.",
  },
  {
    question: "Where does attendance risk come from if there is no biometric integration?",
    answer:
      "There is no direct device integration by design. HR exports the file from the biometric software and imports it, which keeps a human-verified record of every upload.",
  },
  {
    question: "Can a Founder/CEO account edit employees?",
    answer:
      "No. Executive accounts are read-focused. Workforce mutations, imports, reviews and candidate moves are performed by the HR role, and the restriction is enforced on the backend and in the database — not just hidden in the interface.",
  },
];

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Help & support"
        description="How HR Signal AI connects attendance, performance, recruitment and risk into verified decisions."
        breadcrumbs={[{ label: "Help & Support" }]}
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
          Roles in this workspace
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <ToneBadge tone="primary">{ROLE_LABELS.hr}</ToneBadge>
            <p className="mt-2 text-sm text-muted-foreground">
              Default route <code className="rounded bg-muted px-1 py-0.5 text-xs">/dashboard</code>. Manages
              employees, departments, attendance imports, performance reviews, tasks, recruitment and actions, and
              requests executive approval for sensitive work.
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <ToneBadge tone="insight">{ROLE_LABELS.founder}</ToneBadge>
            <p className="mt-2 text-sm text-muted-foreground">
              Default route <code className="rounded bg-muted px-1 py-0.5 text-xs">/executive</code>. Reviews workforce
              health, HR team performance, strategic risk and recommendations, and approves or rejects sensitive actions.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Workflows</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {WORKFLOWS.map((workflow) => (
            <article key={workflow.title} className="rounded-lg border border-border bg-card p-5 shadow-card">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <workflow.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                {workflow.title}
              </h3>
              <ol className="mt-3 space-y-2">
                {workflow.steps.map((step, index) => (
                  <li key={step} className="flex gap-2.5 text-sm text-muted-foreground">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Frequently asked</h2>
        <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
          {FAQ.map((item) => (
            <details key={item.question} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  {item.question}
                  <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
                  <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
                </span>
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-primary" aria-hidden="true" />
          Data model at a glance
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Workforce establishes employee and department identities. Attendance, performance, tasks and recruitment all
          reference those identities. Internships create or link an intern employee, hiring promotes that same record.
          Dashboards aggregate verified module data, the backend risk engine scores it, insights explain it, and actions
          with approvals preserve the decision history.
        </p>
      </section>
    </div>
  );
}
