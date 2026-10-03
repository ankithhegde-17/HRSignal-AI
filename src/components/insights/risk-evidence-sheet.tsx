import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Compass, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EvidenceQualityBadge, RiskBadge, ToneBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { supabase } from "@/lib/db";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { formatDate, formatPercent, formatScore } from "@/lib/format";
import { COMBINED_RISK_WEIGHTS, SIGNAL_TYPE_LABELS, type Signal } from "@/lib/types";

const METRIC_LABELS: Record<string, string> = {
  attendance_rate: "Attendance rate",
  attendance_records: "Attendance records (30d)",
  present: "Present days",
  late: "Late check-ins",
  absent: "Absences",
  leave: "Leave days",
  half_day: "Half days",
  latest_review_score: "Latest performance score",
  previous_review_score: "Previous performance score",
  performance_trend: "Performance trend",
  tasks_total: "Tracked tasks",
  tasks_completed: "Tasks completed",
  tasks_blocked: "Tasks blocked",
  headcount: "Headcount",
  average_performance: "Average performance",
  task_completion_rate: "Task completion rate",
  employees_high_risk: "Employees in high risk band",
  open_requisitions: "Open requisitions",
  total_openings: "Total openings",
  active_pipeline: "Active pipeline",
  late_stage_candidates: "Late-stage candidates",
  employment_status: "Employment status",
  window_days: "Evidence window (days)",
};

function renderMetric(key: string, value: unknown) {
  if (value == null) return "—";
  if (key === "attendance_rate" || key === "task_completion_rate") {
    return formatPercent(Number(value) * 100);
  }
  if (key === "average_performance" || key === "latest_review_score" || key === "previous_review_score") {
    return formatScore(Number(value));
  }
  if (typeof value === "number") return String(value);
  return String(value);
}

interface RiskEvidenceSheetProps {
  signal: Signal | null;
  onClose: () => void;
  onCreateAction: (signal: Signal) => void;
}

export function RiskEvidenceSheet({ signal, onClose, onCreateAction }: RiskEvidenceSheetProps) {
  const { openEmployee360 } = useEmployee360();

  const employeeQuery = useQuery({
    queryKey: ["risk-evidence-employee", signal?.entity_id],
    enabled: Boolean(signal && signal.entity_type === "employee"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select("id, full_name, code, job_title, status")
        .eq("id", signal!.entity_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const departmentQuery = useQuery({
    queryKey: ["risk-evidence-department", signal?.entity_id],
    enabled: Boolean(signal && signal.entity_type === "department"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_departments")
        .select("id, name, code")
        .eq("id", signal!.entity_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const relatedActions = useQuery({
    queryKey: ["risk-related-actions", signal?.id],
    enabled: Boolean(signal),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_actions")
        .select("id, title, status, priority")
        .eq("source_type", "signal")
        .eq("source_ref", signal!.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const evidence = (signal?.evidence ?? {}) as Record<string, unknown>;
  const metricEntries = Object.entries(evidence).filter(
    ([key]) => key !== "metric" && key !== "weights" && key !== "formula_version" && key !== "limitations",
  );

  return (
    <Sheet open={Boolean(signal)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto p-0 sm:max-w-xl">
        {!signal ? null : (
          <>
            <SheetHeader className="border-b border-border px-6 py-5 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-lg">
                    {SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type}
                  </SheetTitle>
                  <SheetDescription>
                    {employeeQuery.data?.full_name ?? departmentQuery.data?.name ?? "Entity"} · detected{" "}
                    {formatDate(signal.detected_at)}
                  </SheetDescription>
                </div>
                <RiskBadge score={signal.score} severity={signal.severity} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <EvidenceQualityBadge quality={signal.evidence_quality} />
                <ToneBadge tone="neutral">Formula {signal.formula_version}</ToneBadge>
                <ToneBadge tone="workflow">{signal.status}</ToneBadge>
              </div>
            </SheetHeader>

            <div className="space-y-4 px-6 py-5">
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What the engine found
                </h3>
                <p className="mt-2 text-sm text-foreground">{signal.explanation ?? "No explanation recorded."}</p>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Verified metrics
                </h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {metricEntries.map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {METRIC_LABELS[key] ?? key.replace(/_/g, " ")}
                      </dt>
                      <dd className="mt-0.5 truncate tabular-nums">{renderMetric(key, value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  Combined risk uses attendance {(COMBINED_RISK_WEIGHTS.attendance * 100).toFixed(0)}%, performance{" "}
                  {(COMBINED_RISK_WEIGHTS.performance * 100).toFixed(0)}% and task/goal trend{" "}
                  {(COMBINED_RISK_WEIGHTS.taskTrend * 100).toFixed(0)}%. Severity bands: 0–34 low, 35–59 medium, 60–79
                  high, 80–100 critical.
                </p>
              </section>

              {signal.recommendation ? (
                <section className="rounded-lg border border-insight/25 bg-insight-soft p-4">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-insight">
                    <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                    Recommendation
                  </h3>
                  <p className="mt-2 text-sm text-foreground">{signal.recommendation}</p>
                  <p className="mt-2 text-xs text-insight/90">
                    This is a suggested next step, not a decision. Hiring, rejection, promotion and disciplinary outcomes
                    always remain human decisions.
                  </p>
                </section>
              ) : null}

              {signal.limitations ? (
                <section className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-soft p-4 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-medium">Limitations</p>
                    <p className="mt-1">{signal.limitations}</p>
                  </div>
                </section>
              ) : (
                <section className="flex items-start gap-2 rounded-lg border border-success/25 bg-success-soft p-4 text-sm text-success">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>Evidence quality is strong for this window; no material limitations were recorded.</p>
                </section>
              )}

              <section className="rounded-lg border border-border bg-card">
                <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Related actions
                </h3>
                {relatedActions.isLoading ? (
                  <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading…
                  </p>
                ) : relatedActions.isError ? (
                  <div className="p-4">
                    <ErrorState onRetry={() => void relatedActions.refetch()} />
                  </div>
                ) : (relatedActions.data ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    No action has been created from this signal yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {relatedActions.data!.map((action) => (
                      <li key={action.id} className="flex items-center justify-between gap-2 px-4 py-3">
                        <p className="truncate text-sm">{action.title}</p>
                        <ToneBadge tone="workflow">{action.status.replace(/_/g, " ")}</ToneBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onCreateAction(signal)}>
                  Create action from this signal
                </Button>
                {signal.entity_type === "employee" && employeeQuery.data ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onClose();
                      openEmployee360(signal.entity_id);
                    }}
                  >
                    <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    Open employee 360°
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Small inline caption clarifying that signals never make the decision. */
export function SignalDisclaimer() {
  return (
    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      Risk signals prioritise attention using a versioned, deterministic formula computed on the backend. They never
      trigger automatic hiring, rejection, promotion, disciplinary or termination decisions.
    </p>
  );
}

export function NoSignalsState({ description }: { description?: string }) {
  return (
    <EmptyState
      title="Insufficient data"
      description={description ?? "No verified signal has been computed for this scope yet."}
      icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
    />
  );
}
