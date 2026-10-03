import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Compass,
  ListChecks,
  Lightbulb,
  Loader2,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToneBadge, RiskBadge, StatusBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/db";
import { formatDate, formatMinutes, formatPercent, formatScore, initials } from "@/lib/format";
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUS_TONE,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_TONE,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONE,
  SIGNAL_TYPE_LABELS,
  TASK_STATUS_LABELS,
  WORK_MODE_LABELS,
  WORK_MODE_TONE,
  type Employee,
} from "@/lib/types";

function useEmployee(employeeId: string | null) {
  return useQuery<Employee | null>({
    queryKey: ["employee-360", employeeId],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").eq("id", employeeId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Employee | null) ?? null;
    },
  });
}

function Panel({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {title ? <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4> : null}
      {children}
    </section>
  );
}

function Definition({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

function OverviewTab({ employee }: { employee: Employee }) {
  const { data: department } = useQuery({
    queryKey: ["employee-360-department", employee.department_id],
    enabled: Boolean(employee.department_id),
    queryFn: async () => {
      const { data } = await supabase.from("hr_departments").select("name").eq("id", employee.department_id).maybeSingle();
      return (data?.name as string | undefined) ?? null;
    },
  });

  const { data: manager } = useQuery({
    queryKey: ["employee-360-manager", employee.manager_id],
    enabled: Boolean(employee.manager_id),
    queryFn: async () => {
      const { data } = await supabase.from("hr_employees").select("full_name").eq("id", employee.manager_id).maybeSingle();
      return (data?.full_name as string | undefined) ?? null;
    },
  });

  const { data: team } = useQuery({
    queryKey: ["employee-360-team", employee.team_id],
    enabled: Boolean(employee.team_id),
    queryFn: async () => {
      const { data } = await supabase.from("hr_teams").select("name, team_code").eq("id", employee.team_id).maybeSingle();
      return data ? `${data.name} (${data.team_code})` : null;
    },
  });

  return (
    <div className="space-y-4">
      <Panel title="Employment">
        <dl className="grid grid-cols-2 gap-4">
          <Definition label="Employee code" value={<span className="font-mono text-xs">{employee.code}</span>} />
          <Definition label="Job title" value={employee.job_title} />
          <Definition label="Department" value={department} />
          <Definition label="Team" value={team} />
          <Definition label="Reporting to" value={manager} />
          <Definition label="Employment type" value={EMPLOYMENT_TYPE_LABELS[employee.employment_type]} />
          <Definition label="Work mode" value={WORK_MODE_LABELS[employee.work_mode]} />
          <Definition label="Location" value={employee.location} />
          <Definition label="Joined" value={formatDate(employee.joining_date)} />
          <Definition label="Exit date" value={employee.exit_date ? formatDate(employee.exit_date) : "—"} />
          <Definition label="Status" value={EMPLOYEE_STATUS_LABELS[employee.status]} />
        </dl>
      </Panel>

      <Panel title="Contact">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Definition label="Work email" value={<span className="break-all">{employee.work_email}</span>} />
          <Definition label="Personal email" value={<span className="break-all">{employee.personal_email}</span>} />
          <Definition label="Phone" value={employee.phone} />
        </dl>
      </Panel>

      <Panel title="Skills">
        {employee.skills && employee.skills.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {employee.skills.map((skill) => (
              <li key={skill}>
                <ToneBadge tone="primary">{skill}</ToneBadge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No skills recorded.</p>
        )}
      </Panel>
    </div>
  );
}

function AttendanceTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employee-360-attendance", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance")
        .select("*")
        .eq("employee_id", employeeId)
        .order("attendance_date", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={6} columns={4} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return <EmptyState title="No attendance records" description="Attendance appears once an import is confirmed for this employee." />;
  }

  const present = data.filter((r) => r.status === "present").length;
  const late = data.filter((r) => r.status === "late").length;
  const absent = data.filter((r) => r.status === "absent").length;
  const credited = present + late * 0.5 + data.filter((r) => r.status === "half-day").length * 0.5;
  const rate = data.length ? (credited / data.length) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Panel>
          <p className="text-[11px] uppercase text-muted-foreground">Records</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{data.length}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase text-muted-foreground">Attendance rate</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatPercent(rate)}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase text-muted-foreground">Late</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{late}</p>
        </Panel>
        <Panel>
          <p className="text-[11px] uppercase text-muted-foreground">Absent</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{absent}</p>
        </Panel>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {data.slice(0, 14).map((record) => (
          <li key={record.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{formatDate(record.attendance_date)}</p>
              <p className="text-xs text-muted-foreground">
                {record.check_in ? formatMinutes(record.working_minutes) : "No check-in recorded"}
              </p>
            </div>
            <StatusBadge value={record.status} labels={ATTENDANCE_STATUS_LABELS} tones={ATTENDANCE_STATUS_TONE} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TasksTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employee-360-tasks", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_tasks")
        .select("*")
        .eq("employee_id", employeeId)
        .order("due_date", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={5} columns={3} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!data || data.length === 0) return <EmptyState title="No tasks tracked" description="Tasks assigned to this employee will appear here." />;

  const completed = data.filter((t) => t.status === "completed").length;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {completed} of {data.length} tasks complete
          </p>
          <ToneBadge tone={completed / data.length >= 0.7 ? "success" : completed / data.length >= 0.4 ? "warning" : "critical"}>
            {formatPercent((completed / data.length) * 100, 0)} completion
          </ToneBadge>
        </div>
      </Panel>

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {data.map((task) => (
          <li key={task.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Due {formatDate(task.due_date)} · {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}
              </p>
            </div>
            <StatusBadge
              value={task.priority as keyof typeof PRIORITY_LABELS}
              labels={PRIORITY_LABELS}
              tones={PRIORITY_TONE}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PerformanceTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employee-360-performance", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_performance_reviews")
        .select("*")
        .eq("employee_id", employeeId)
        .order("period_end", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={4} columns={4} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No performance review"
        description="This employee has no submitted review, so no performance risk can be evidenced. Attendance is tracked separately and never reduces the performance score."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Attendance and performance are independent datasets. Attendance is shown for context only and does not
        automatically change the performance score.
      </p>
      {data.map((review) => (
        <Panel key={review.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {formatDate(review.period_start)} – {formatDate(review.period_end)}
            </p>
            <StatusBadge
              value={review.status as keyof typeof REVIEW_STATUS_LABELS}
              labels={REVIEW_STATUS_LABELS}
              tones={REVIEW_STATUS_TONE}
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Definition label="Performance" value={formatScore(review.performance_score)} />
            <Definition label="Goals" value={formatScore(review.goal_score)} />
            <Definition label="Tasks" value={formatScore(review.task_score)} />
            <Definition label="Manager rating" value={review.manager_rating ? `${review.manager_rating}/5` : "—"} />
          </dl>
          {review.comments ? <p className="mt-3 text-sm text-muted-foreground">{review.comments}</p> : null}
        </Panel>
      ))}
    </div>
  );
}

function RiskTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employee-360-signals", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_signals")
        .select("*")
        .eq("entity_type", "employee")
        .eq("entity_id", employeeId)
        .order("score", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={5} columns={3} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="Insufficient data"
        description="No verified risk signal has been computed for this employee yet. Run the risk engine after attendance and performance are recorded."
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.map((signal) => (
        <Panel key={signal.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {SIGNAL_TYPE_LABELS[signal.signal_type as keyof typeof SIGNAL_TYPE_LABELS] ?? signal.signal_type}
            </p>
            <div className="flex items-center gap-2">
              <RiskBadge score={signal.score} severity={signal.severity} />
              <ToneBadge tone="neutral">Formula {signal.formula_version}</ToneBadge>
            </div>
          </div>
          {signal.explanation ? <p className="mt-2 text-sm text-muted-foreground">{signal.explanation}</p> : null}
          {signal.recommendation ? (
            <p className="mt-2 flex items-start gap-2 text-sm text-foreground">
              <Compass className="mt-0.5 h-4 w-4 shrink-0 text-insight" aria-hidden="true" />
              <span>{signal.recommendation}</span>
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Definition label="Evidence quality" value={signal.evidence_quality} />
            <Definition label="Review status" value={signal.status} />
            <Definition label="Detected" value={formatDate(signal.detected_at)} />
            <Definition
              label="Attendance rate"
              value={formatPercent(Number(signal.evidence?.attendance_rate ?? NaN) * 100)}
            />
          </dl>
          {signal.limitations ? (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{signal.limitations}</span>
            </p>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}

function InsightsTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employee-360-insights", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_ai_insights")
        .select("*")
        .eq("entity_type", "employee")
        .eq("entity_id", employeeId)
        .order("generated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={3} columns={3} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No employee-level insights"
        description="Organization and department insights are available in the Insights workspace."
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.map((insight) => (
        <Panel key={insight.id}>
          <div className="flex items-start gap-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-insight" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{insight.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{insight.summary}</p>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function ActionsTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employee-360-actions", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_actions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      // Actions reference the employee through their source reference or description.
      return (data ?? []).filter(
        (action) => action.source_ref === employeeId || (action.description ?? "").includes(employeeId),
      );
    },
  });

  const { data: audit } = useQuery({
    queryKey: ["employee-360-audit", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_audit_log")
        .select("*")
        .eq("entity_id", employeeId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={4} columns={3} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      <Panel title="Linked actions">
        {!data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No action is linked to this employee yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((action) => (
              <li key={action.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{action.title}</p>
                  <p className="text-xs text-muted-foreground">Due {formatDate(action.due_date)}</p>
                </div>
                <StatusBadge
                  value={action.status as keyof typeof ACTION_STATUS_LABELS}
                  labels={ACTION_STATUS_LABELS}
                  tones={ACTION_STATUS_TONE}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Audit history">
        {!audit || audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit entries for this employee yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {audit.map((entry) => (
              <li key={entry.id} className="py-2.5">
                <p className="text-sm text-foreground">{entry.action.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(entry.created_at)}{entry.actor_email ? ` · ${entry.actor_email}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */

export function Employee360Drawer({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const { data: employee, isLoading, isError, refetch } = useEmployee(employeeId);

  return (
    <Sheet open={Boolean(employeeId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        {isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading employee profile…
          </div>
        ) : isError ? (
          <div className="p-6">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        ) : !employee ? (
          <div className="p-6">
            <EmptyState title="Employee not found" description="This record may have been removed." />
          </div>
        ) : (
          <>
            <SheetHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary-soft text-sm font-semibold text-primary">
                    {initials(employee.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-lg">{employee.full_name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {employee.job_title ?? "—"} · {employee.code}
                  </SheetDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge value={employee.status} labels={EMPLOYEE_STATUS_LABELS} tones={EMPLOYEE_STATUS_TONE} />
                    <StatusBadge value={employee.work_mode} labels={WORK_MODE_LABELS} tones={WORK_MODE_TONE} />
                    <StatusBadge
                      value={employee.employment_type}
                      labels={EMPLOYMENT_TYPE_LABELS}
                      tones={EMPLOYMENT_TYPE_TONE}
                    />
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="hr-scroll-area min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <Tabs defaultValue="overview">
                <TabsList className="mb-4 flex w-full flex-wrap justify-start gap-1 bg-muted p-1 h-auto">
                  <TabsTrigger value="overview" className="gap-1.5">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> Overview
                  </TabsTrigger>
                  <TabsTrigger value="attendance" className="gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> Attendance
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Tasks
                  </TabsTrigger>
                  <TabsTrigger value="performance" className="gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Performance
                  </TabsTrigger>
                  <TabsTrigger value="risk" className="gap-1.5">
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Risk Evidence
                  </TabsTrigger>
                  <TabsTrigger value="insights" className="gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Insights
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Action History
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  <OverviewTab employee={employee} />
                </TabsContent>
                <TabsContent value="attendance">
                  <AttendanceTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="tasks">
                  <TasksTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="performance">
                  <PerformanceTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="risk">
                  <RiskTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="insights">
                  <InsightsTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="actions">
                  <ActionsTab employeeId={employee.id} />
                </TabsContent>
              </Tabs>
            </div>

            <div className="shrink-0 border-t border-border px-6 py-3">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/performance/employees?employee=${employee.id}`}>Open in Performance</Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
