import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, PencilLine, Plus, Send, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState, QueryState, TableSkeleton } from "@/components/shared/states";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ClearFiltersButton, FilterBar, SearchInput, SelectFilter } from "@/components/shared/filter-bar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeOptions, useTeamNameMap, useTeamOptions } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate, formatScore } from "@/lib/format";
import { toast } from "sonner";
import {
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_OPTIONS,
  REVIEW_STATUS_TONE,
  type Employee,
  type PerformanceReview,
  type ReviewStatus,
} from "@/lib/types";

interface ReviewRow {
  employee: Employee;
  latest: PerformanceReview | null;
  previous: PerformanceReview | null;
  trend: number | null;
}

export default function PerformanceEmployeesPage() {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const { openEmployee360 } = useEmployee360();
  const { options: departmentOptions } = useDepartmentOptions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [submittingReview, setSubmittingReview] = useState<PerformanceReview | null>(null);

  // Team options depend on the selected department and must be declared after it.
  const { options: teamOptions } = useTeamOptions(department === "all" ? null : department);
  const teamName = useTeamNameMap();

  useRealtimeRefresh(["hr_performance_reviews"], [["performance-employees"]]);
  const { data, isLoading, isError, refetch } = useQuery<ReviewRow[]>({
    queryKey: ["performance-employees"],
    queryFn: async () => {
      const [employees, reviews] = await Promise.all([
        supabase.from("hr_employees").select("*").neq("status", "exited").order("full_name").limit(1000),
        supabase.from("hr_performance_reviews").select("*").order("period_end", { ascending: false }).limit(4000),
      ]);
      if (employees.error) throw new Error(employees.error.message);
      if (reviews.error) throw new Error(reviews.error.message);

      const byEmployee = new Map<string, PerformanceReview[]>();
      ((reviews.data ?? []) as PerformanceReview[]).forEach((review) => {
        if (!byEmployee.has(review.employee_id)) byEmployee.set(review.employee_id, []);
        byEmployee.get(review.employee_id)!.push(review);
      });

      return ((employees.data ?? []) as Employee[]).map((employee) => {
        const list = byEmployee.get(employee.id) ?? [];
        const submitted = list.filter((review) => review.status !== "draft");
        const latest = submitted[0] ?? list[0] ?? null;
        const previous = submitted[1] ?? null;
        return {
          employee,
          latest,
          previous,
          trend:
            latest?.performance_score != null && previous?.performance_score != null
              ? Number(latest.performance_score) - Number(previous.performance_score)
              : null,
        };
      });
    },
  });

  const openEditor = (employee: Employee) => {
    setEditingEmployee(employee);
    setEditorOpen(true);
  };

  // Deep link: /performance/employees?employee=<id> opens the shared drawer once.
  useEffect(() => {
    const id = searchParams.get("employee");
    if (!id) return;
    openEmployee360(id);
    const next = new URLSearchParams(searchParams);
    next.delete("employee");
    setSearchParams(next, { replace: true });
  }, [openEmployee360, searchParams, setSearchParams]);

  const departmentName = useMemo(() => {
    const map = new Map(departmentOptions.map((option) => [option.value, option.label]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [departmentOptions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((row) => {
      if (department !== "all" && row.employee.department_id !== department) return false;
      if (team !== "all" && row.employee.team_id !== team) return false;
      if (status !== "all") {
        const resolved = row.latest?.status ?? "none";
        if (status === "none" ? row.latest != null : resolved !== status) return false;
      }
      if (!term) return true;
      return (
        row.employee.full_name.toLowerCase().includes(term) || row.employee.code.toLowerCase().includes(term)
      );
    });
  }, [data, department, search, status, team]);

  const submitReview = useMutation({
    mutationFn: async (review: PerformanceReview) => {
      const { error } = await supabase.from("hr_performance_reviews").update({ status: "submitted" }).eq("id", review.id);
      if (error) throw new Error(error.message);
      await supabase.from("hr_audit_log").insert({
        actor_id: profile?.user_id ?? null,
        actor_email: profile?.email ?? null,
        entity_type: "performance_review",
        entity_id: review.id,
        action: "review_submitted",
        before_json: { status: review.status },
        after_json: { status: "submitted" },
      });
    },
    onSuccess: () => {
      toast.success("Review submitted. Employee and department aggregates updated.");
      setSubmittingReview(null);
      void queryClient.invalidateQueries({ queryKey: ["performance-employees"] });
      void queryClient.invalidateQueries({ queryKey: ["performance-departments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: Column<ReviewRow>[] = [
    {
      key: "employee",
      header: "Employee",
      sortValue: (row) => row.employee.full_name,
      cell: (row) => (
        <button type="button" className="min-w-0 text-left hover:text-primary" onClick={() => openEmployee360(row.employee.id)}>
          <p className="truncate font-medium">{row.employee.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.employee.job_title ?? "—"} · {departmentName(row.employee.department_id)}
          </p>
        </button>
      ),
    },
    {
      key: "team",
      header: "Team",
      sortValue: (row) => teamName.get(row.employee.team_id ?? "") ?? "",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.employee.team_id ? teamName.get(row.employee.team_id) ?? "—" : "—"}
        </span>
      ),
      hideBelow: "lg",
    },
    {
      key: "performance_score",
      header: "Score",
      align: "right",
      sortValue: (row) => Number(row.latest?.performance_score ?? -1),
      cell: (row) =>
        row.latest?.performance_score != null ? (
          <span className="tabular-nums font-medium">{formatScore(row.latest.performance_score)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Not reviewed</span>
        ),
    },
    {
      key: "previous",
      header: "Previous",
      align: "right",
      sortValue: (row) => Number(row.previous?.performance_score ?? -1),
      cell: (row) => <span className="tabular-nums text-muted-foreground">{formatScore(row.previous?.performance_score ?? null)}</span>,
      hideBelow: "md",
    },
    {
      key: "trend",
      header: "Trend",
      align: "right",
      sortValue: (row) => row.trend ?? 0,
      cell: (row) =>
        row.trend == null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${row.trend >= 0 ? "text-success" : "text-destructive"}`}>
            {row.trend >= 0 ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
            {row.trend >= 0 ? "+" : ""}
            {row.trend.toFixed(1)}
          </span>
        ),
      hideBelow: "md",
    },
    {
      key: "goal_score",
      header: "Goals",
      align: "right",
      sortValue: (row) => Number(row.latest?.goal_score ?? -1),
      cell: (row) => <span className="tabular-nums">{formatScore(row.latest?.goal_score ?? null)}</span>,
      hideBelow: "lg",
    },
    {
      key: "task_score",
      header: "Tasks",
      align: "right",
      sortValue: (row) => Number(row.latest?.task_score ?? -1),
      cell: (row) => <span className="tabular-nums">{formatScore(row.latest?.task_score ?? null)}</span>,
      hideBelow: "lg",
    },
    {
      key: "period",
      header: "Period",
      sortValue: (row) => row.latest?.period_end ?? "",
      cell: (row) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {row.latest ? `${formatDate(row.latest.period_start)} – ${formatDate(row.latest.period_end)}` : "—"}
        </span>
      ),
      hideBelow: "lg",
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.latest?.status ?? "none",
      cell: (row) =>
        row.latest ? (
          <StatusBadge value={row.latest.status} labels={REVIEW_STATUS_LABELS} tones={REVIEW_STATUS_TONE} />
        ) : (
          <ToneBadge tone="warning">No review</ToneBadge>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Open 360 for ${row.employee.full_name}`} onClick={() => openEmployee360(row.employee.id)}>
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          {isHr ? (
            <>
              <Button variant="ghost" size="icon" aria-label={`Edit review for ${row.employee.full_name}`} onClick={() => openEditor(row.employee)}>
                <PencilLine className="h-4 w-4" aria-hidden="true" />
              </Button>
              {row.latest && row.latest.status === "draft" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Submit review for ${row.employee.full_name}`}
                  onClick={() => setSubmittingReview(row.latest)}
                >
                  <Send className="h-4 w-4 text-primary" aria-hidden="true" />
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const hasFilters = Boolean(search) || department !== "all" || team !== "all" || status !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employee performance"
        description="Reviews, scores and trends. Attendance is tracked separately and never reduces a performance score."
        breadcrumbs={[{ label: "Performance", to: "/performance/departments" }, { label: "Employees" }]}
        actions={
          isHr ? (
            <Button size="sm" onClick={() => openEditor(filtered[0]?.employee ?? (data?.[0]?.employee as Employee))}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Create review
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search employee name or code…" />
        <SelectFilter label="Department" value={department} onChange={(value) => { setDepartment(value); setTeam("all"); }} options={departmentOptions} />
        <SelectFilter
          label="Team"
          value={team}
          onChange={setTeam}
          options={teamOptions}
          allLabel="All teams"
          disabled={department === "all" || teamOptions.length === 0}
        />
        <SelectFilter
          label="Review status"
          value={status}
          onChange={setStatus}
          options={[
            ...REVIEW_STATUS_OPTIONS.map((option) => ({ value: option, label: REVIEW_STATUS_LABELS[option] })),
            { value: "none", label: "No review" },
          ]}
        />
        <ClearFiltersButton
          visible={hasFilters}
          onClick={() => {
            setSearch("");
            setDepartment("all");
            setTeam("all");
            setStatus("all");
          }}
        />
      </FilterBar>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <TableSkeleton rows={7} columns={6} />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.employee.id}
          initialSort={{ key: "performance_score", direction: "desc" }}
          pageSize={15}
          caption="Employee performance reviews"
          emptyState={<EmptyState title="No employees match" description="Adjust the filters or add employees first." />}
        />
      </QueryState>

      <ReviewEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        employee={editingEmployee}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["performance-employees"] });
          void queryClient.invalidateQueries({ queryKey: ["performance-departments"] });
        }}
      />

      <ConfirmDialog
        open={Boolean(submittingReview)}
        onOpenChange={(open) => (!open ? setSubmittingReview(null) : undefined)}
        title="Submit this performance review?"
        description="Submitting makes the review visible in employee and department aggregates and writes an audit entry. Attendance figures are not affected."
        confirmLabel="Submit review"
        busy={submitReview.isPending}
        onConfirm={() => submittingReview && submitReview.mutate(submittingReview)}
      />
    </div>
  );
}

function ReviewEditorDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const {
    options: employeeOptions,
    isLoading: optionsLoading,
    isError: optionsError,
    refetch: refetchOptions,
  } = useEmployeeOptions();
  const queryClient = useQueryClient();
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [periodStart, setPeriodStart] = useState(new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [performanceScore, setPerformanceScore] = useState("");
  const [goalScore, setGoalScore] = useState("");
  const [taskScore, setTaskScore] = useState("");
  const [managerRating, setManagerRating] = useState("3");
  const [comments, setComments] = useState("");
  const [status, setStatus] = useState<ReviewStatus>("draft");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the dialog opens for a different employee.
  useEffect(() => {
    if (!open) return;
    setSelectedEmployee(employee?.id ?? "");
    setErrors({});
    setExistingId(null);
    setComments("");
    setPerformanceScore("");
    setGoalScore("");
    setTaskScore("");
    setManagerRating("3");
    setStatus("draft");
  }, [employee, open]);

  // When editing an employee, prefill the latest existing review (a draft is
  // preferred, otherwise the most recent submitted one) so the edit form has
  // complete initial values and writes back to the correct record.
  useEffect(() => {
    if (!open || !employee?.id) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("hr_performance_reviews")
        .select("*")
        .eq("employee_id", employee.id)
        .order("period_end", { ascending: false });
      if (cancelled) return;
      if (error) {
        setErrors((current) => ({ ...current, employee: "Could not load the existing review." }));
        return;
      }
      const reviews = (data ?? []) as PerformanceReview[];
      const target = reviews.find((review) => review.status === "draft") ?? reviews[0] ?? null;
      if (!target) return; // create mode: the empty defaults above are correct
      setPeriodStart(target.period_start);
      setPeriodEnd(target.period_end);
      setPerformanceScore(target.performance_score != null ? String(target.performance_score) : "");
      setGoalScore(target.goal_score != null ? String(target.goal_score) : "");
      setTaskScore(target.task_score != null ? String(target.task_score) : "");
      setManagerRating(target.manager_rating != null ? String(target.manager_rating) : "3");
      setComments(target.comments ?? "");
      setStatus(target.status);
      setExistingId(target.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [employee, open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!selectedEmployee) next.employee = "Select an employee.";
    if (!periodStart) next.periodStart = "Period start is required.";
    if (!periodEnd) next.periodEnd = "Period end is required.";
    if (periodStart && periodEnd && periodEnd < periodStart) next.periodEnd = "Period end must be after the start.";
    const numeric = (value: string) => (value === "" ? null : Number(value));
    for (const [key, value] of [["performanceScore", performanceScore], ["goalScore", goalScore], ["taskScore", taskScore]] as const) {
      if (value !== "" && (Number.isNaN(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
        next[key] = "Enter a value between 0 and 100.";
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const targetEmployee = (employeeOptions.length > 0 && selectedEmployee)
        ? selectedEmployee
        : employee?.id ?? selectedEmployee;

      const { data: employeeRow, error: employeeError } = await supabase
        .from("hr_employees")
        .select("department_id")
        .eq("id", targetEmployee)
        .maybeSingle();
      if (employeeError) throw employeeError;

      const payload = {
        employee_id: targetEmployee,
        department_id: employeeRow?.department_id ?? null,
        reviewer_id: profile?.user_id ?? null,
        period_start: periodStart,
        period_end: periodEnd,
        performance_score: numeric(performanceScore),
        goal_score: numeric(goalScore),
        task_score: numeric(taskScore),
        manager_rating: managerRating ? Number(managerRating) : null,
        comments: comments.trim() || null,
        status,
      };

      let reviewId = existingId;
      if (!reviewId) {
        // A review is unique per employee and period, so reuse the existing row
        // instead of attempting a duplicate insert.
        const { data: match } = await supabase
          .from("hr_performance_reviews")
          .select("id")
          .eq("employee_id", targetEmployee)
          .eq("period_start", periodStart)
          .eq("period_end", periodEnd)
          .maybeSingle();
        reviewId = match?.id ?? null;
      }

      if (reviewId) {
        const { error } = await supabase.from("hr_performance_reviews").update(payload).eq("id", reviewId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("hr_performance_reviews").insert(payload).select("id").single();
        if (error) throw error;
        reviewId = data.id;
      }

      await supabase.from("hr_audit_log").insert({
        actor_id: profile?.user_id ?? null,
        actor_email: profile?.email ?? null,
        entity_type: "performance_review",
        entity_id: reviewId,
        action: reviewId ? "review_updated" : "review_created",
        after_json: payload,
      });

      toast.success(status === "draft" ? "Draft saved." : "Review submitted.");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(/duplicate|unique/i.test(message) ? "A review already exists for that employee and period." : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Performance review</DialogTitle>
          <DialogDescription>
            Save as a draft, or submit to publish the score. Attendance remains a separate dataset.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Employee *</Label>
            <select
              value={selectedEmployee}
              onChange={(event) => setSelectedEmployee(event.target.value)}
              disabled={saving || Boolean(employee)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <option value="">Select an employee</option>
              {optionsLoading ? (
                <option value="__loading__" disabled>
                  Loading employees…
                </option>
              ) : null}
              {employee && !employeeOptions.some((option) => option.value === employee.id) ? (
                <option value={employee.id}>{employee.full_name}</option>
              ) : null}
              {employeeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {optionsError ? (
              <p className="text-xs text-warning">
                Employee list failed to load.{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => refetchOptions()}>
                  Retry
                </button>
              </p>
            ) : null}
            {errors.employee ? <p className="text-xs text-destructive">{errors.employee}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Period start *</Label>
              <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} disabled={saving} />
              {errors.periodStart ? <p className="text-xs text-destructive">{errors.periodStart}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Period end *</Label>
              <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} disabled={saving} />
              {errors.periodEnd ? <p className="text-xs text-destructive">{errors.periodEnd}</p> : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Performance (0–100)</Label>
              <Input inputMode="decimal" value={performanceScore} onChange={(event) => setPerformanceScore(event.target.value)} disabled={saving} />
              {errors.performanceScore ? <p className="text-xs text-destructive">{errors.performanceScore}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Goals (0–100)</Label>
              <Input inputMode="decimal" value={goalScore} onChange={(event) => setGoalScore(event.target.value)} disabled={saving} />
              {errors.goalScore ? <p className="text-xs text-destructive">{errors.goalScore}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tasks (0–100)</Label>
              <Input inputMode="decimal" value={taskScore} onChange={(event) => setTaskScore(event.target.value)} disabled={saving} />
              {errors.taskScore ? <p className="text-xs text-destructive">{errors.taskScore}</p> : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Manager rating (1–5)</Label>
              <select
                value={managerRating}
                onChange={(event) => setManagerRating(event.target.value)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as ReviewStatus)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Comments</Label>
            <Textarea rows={3} value={comments} onChange={(event) => setComments(event.target.value)} disabled={saving} />
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {status === "draft" ? "Save draft" : "Save and submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
