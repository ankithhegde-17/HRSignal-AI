import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Eye, Layers, Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState, ErrorState, QueryState, TableSkeleton } from "@/components/shared/states";
import { RiskBadge, ToneBadge } from "@/components/shared/badges";
import { SearchInput, FilterBar } from "@/components/shared/filter-bar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/db";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate, formatPercent, formatScore } from "@/lib/format";
import { toast } from "sonner";
import type { Department, Employee } from "@/lib/types";

interface DepartmentRow extends Department {
  employees: Employee[];
  openRequisitions: number;
  teamCount: number;
}

export default function WorkforceDepartmentsPage() {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useRealtimeRefresh(["hr_departments", "hr_employees"], [["workforce-departments"]]);

  const { data, isLoading, isError, refetch } = useQuery<DepartmentRow[]>({
    queryKey: ["workforce-departments"],
    queryFn: async () => {
      const [departments, employees, requisitions, teams] = await Promise.all([
        supabase.from("hr_departments").select("*").eq("is_active", true).order("name"),
        supabase.from("hr_employees").select("id, full_name, department_id, status, work_mode"),
        supabase.from("hr_job_requisitions").select("id, department_id, status"),
        supabase.from("hr_teams").select("id, department_id"),
      ]);
      const firstError = departments.error ?? employees.error ?? requisitions.error ?? teams.error;
      if (firstError) throw new Error(firstError.message);

      return (departments.data ?? []).map((department) => ({
        ...(department as Department),
        employees: (employees.data ?? []).filter((employee) => employee.department_id === department.id) as Employee[],
        openRequisitions: (requisitions.data ?? []).filter(
          (requisition) => requisition.department_id === department.id && requisition.status === "open",
        ).length,
        teamCount: (teams.data ?? []).filter((team) => team.department_id === department.id).length,
      }));
    },
  });

  useEffect(() => {
    if (searchParams.get("new") === "1" && isHr) {
      setEditing(null);
      setFormOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    } else if (searchParams.get("department")) {
      setDetailId(searchParams.get("department"));
      const next = new URLSearchParams(searchParams);
      next.delete("department");
      setSearchParams(next, { replace: true });
    }
  }, [isHr, searchParams, setSearchParams]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter(
      (department) =>
        !term || department.name.toLowerCase().includes(term) || department.code.toLowerCase().includes(term),
    );
  }, [data, search]);

  const detail = useMemo(() => (data ?? []).find((department) => department.id === detailId) ?? null, [data, detailId]);

  const columns: Column<DepartmentRow>[] = [
    {
      key: "name",
      header: "Department",
      sortValue: (row) => row.name,
      cell: (row) => (
        <Link to={`/workforce/departments/${row.id}`} className="block min-w-0 hover:text-primary">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.code}</span>
            {row.description ? ` · ${row.description}` : ""}
          </p>
        </Link>
      ),
    },
    {
      key: "teams",
      header: "Teams",
      align: "right",
      sortValue: (row) => row.teamCount,
      cell: (row) => <span className="tabular-nums">{row.teamCount}</span>,
    },
    {
      key: "headcount",
      header: "Employees",
      align: "right",
      sortValue: (row) => row.employees.length,
      cell: (row) => <span className="tabular-nums">{row.employees.length}</span>,
    },
    {
      key: "active",
      header: "Active",
      align: "right",
      sortValue: (row) => row.employees.filter((employee) => employee.status !== "exited").length,
      cell: (row) => (
        <span className="tabular-nums">{row.employees.filter((employee) => employee.status !== "exited").length}</span>
      ),
      hideBelow: "sm",
    },
    {
      key: "capacity",
      header: "Capacity",
      align: "right",
      sortValue: (row) => row.capacity ?? 0,
      cell: (row) => <span className="tabular-nums">{row.capacity ?? "—"}</span>,
      hideBelow: "md",
    },
    {
      key: "requisitions",
      header: "Open roles",
      align: "right",
      sortValue: (row) => row.openRequisitions,
      cell: (row) => <span className="tabular-nums">{row.openRequisitions}</span>,
      hideBelow: "md",
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Open ${row.name}`} asChild>
            <Link to={`/workforce/departments/${row.id}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          {isHr ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${row.name}`}
              onClick={() => {
                setEditing(row);
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        description="Department structure, capacity and health across the workforce."
        breadcrumbs={[{ label: "Workforce", to: "/workforce/employees" }, { label: "Departments" }]}
        actions={
          isHr ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add department
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search department name or code…" />
      </FilterBar>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No departments yet"
        emptyDescription="Create a department to organise the workforce."
        loadingFallback={
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <TableSkeleton rows={6} columns={5} />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          initialSort={{ key: "name", direction: "asc" }}
          pageSize={12}
          caption="Department directory"
          emptyState={
            <EmptyState
              title="No departments match"
              description="Try a different search term."
              icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
            />
          }
        />
      </QueryState>

      <DepartmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        department={editing}
        onSaved={() => {
          toast.success(editing ? "Department updated." : "Department created.");
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ["workforce-departments"] });
          void queryClient.invalidateQueries({ queryKey: ["departments"] });
        }}
      />

      <DepartmentDetailSheet
        department={detail}
        onClose={() => setDetailId(null)}
        onEdit={(department) => {
          setDetailId(null);
          setEditing(department);
          setFormOpen(true);
        }}
        canEdit={isHr}
      />
    </div>
  );
}

function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: Department | null;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [headId, setHeadId] = useState("");
  const [employees, setEmployees] = useState<Array<{ id: string; full_name: string; code: string }>>([]);
  const [errors, setErrors] = useState<{ name?: string; code?: string; capacity?: string }>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(department?.name ?? "");
    setCode(department?.code ?? "");
    setDescription(department?.description ?? "");
    setCapacity(department?.capacity != null ? String(department.capacity) : "");
    setHeadId(department?.head_employee_id ?? "");
    setErrors({});
    setSubmitError(null);
    setDeleteError(null);

    void (async () => {
      const { data } = await supabase.from("hr_employees").select("id, full_name, code").neq("status", "exited").order("full_name").limit(500);
      setEmployees((data ?? []) as Array<{ id: string; full_name: string; code: string }>);
    })();
  }, [department, open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Department name is required.";
    if (!code.trim()) next.code = "Department code is required.";
    if (capacity && Number.isNaN(Number(capacity))) next.capacity = "Capacity must be a number.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    const payload = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
      capacity: capacity ? Number(capacity) : null,
      head_employee_id: headId || null,
      created_by: profile?.user_id ?? null,
    };

    try {
      if (department) {
        const { error } = await supabase.from("hr_departments").update(payload).eq("id", department.id);
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          actor_id: profile?.user_id ?? null,
          actor_email: profile?.email ?? null,
          entity_type: "department",
          entity_id: department.id,
          action: "department_updated",
          before_json: department as unknown as Record<string, unknown>,
          after_json: payload,
        });
      } else {
        const { data, error } = await supabase.from("hr_departments").insert(payload).select("id").single();
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          actor_id: profile?.user_id ?? null,
          actor_email: profile?.email ?? null,
          entity_type: "department",
          entity_id: data.id,
          action: "department_created",
          after_json: payload,
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitError(/duplicate|unique/i.test(message) ? "A department with that code already exists." : message);
    } finally {
      setSaving(false);
    }
  };

  // Counts shown in the delete confirmation. Loaded only when the dialog opens
  // so the warning always reflects the current state of the department.
  const { data: deleteInfo } = useQuery({
    queryKey: ["department-delete-info", department?.id],
    enabled: Boolean(department) && open && deleteOpen,
    queryFn: async () => {
      const [dept, employeeRows, teamRows] = await Promise.all([
        supabase.from("hr_departments").select("id, name, code, head_employee_id").eq("id", department!.id).maybeSingle(),
        supabase.from("hr_employees").select("id, full_name").eq("department_id", department!.id).limit(1000),
        supabase.from("hr_teams").select("id, name, team_code, team_lead_id").eq("department_id", department!.id),
      ]);
      const firstError = dept.error ?? employeeRows.error ?? teamRows.error;
      if (firstError) throw new Error(firstError.message);
      const employeesList = (employeeRows.data ?? []) as Array<{ id: string; full_name: string }>;
      const teamsList = (teamRows.data ?? []) as Array<{ id: string; name: string; team_code: string; team_lead_id: string | null }>;
      const leadIds = new Set(teamsList.map((team) => team.team_lead_id).filter(Boolean) as string[]);
      return {
        name: (dept.data?.name as string | undefined) ?? department!.name,
        code: (dept.data?.code as string | undefined) ?? department!.code,
        employees: employeesList.length,
        teams: teamsList.length,
        teamLeads: employeesList.filter((employee) => leadIds.has(employee.id)).map((employee) => employee.full_name),
        head: employeesList.find((employee) => employee.id === (dept.data?.head_employee_id ?? null))?.full_name ?? null,
      };
    },
  });

  const canDeletePermanently =
    (deleteInfo?.employees ?? -1) === 0 && (deleteInfo?.teams ?? -1) === 0;

  const runDelete = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string; status?: string }>("department-admin", {
        body: { action: canDeletePermanently ? "delete" : "archive", department_id: department!.id },
        headers: { "Content-Type": "application/json" },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.message ?? "The operation could not be completed.");
      return { status: data.status ?? (canDeletePermanently ? "deleted" : "archived") };
    },
    onSuccess: (result) => {
      toast.success(
        result.status === "deleted"
          ? "Department deleted."
          : "Department archived. Employees, teams and history are preserved.",
      );
      setDeleteOpen(false);
      onOpenChange(false);
      // Refresh active department lists, filters and the dependent team filter.
      void queryClient.invalidateQueries({ queryKey: ["departments"] });
      void queryClient.invalidateQueries({ queryKey: ["workforce-departments"] });
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => setDeleteError(error.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{department ? "Edit department" : "Add department"}</DialogTitle>
            <DialogDescription>Departments group employees and drive department-level health signals.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Name *</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
              {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Code *</Label>
                <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="ENG" disabled={saving} />
                {errors.code ? <p className="text-xs text-destructive">{errors.code}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Capacity</Label>
                <Input
                  type="number"
                  min={0}
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  disabled={saving}
                />
                {errors.capacity ? <p className="text-xs text-destructive">{errors.capacity}</p> : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Department head</Label>
              <select
                value={headId}
                onChange={(event) => setHeadId(event.target.value)}
                disabled={saving}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <option value="">No head assigned</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name} ({employee.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Description</Label>
              <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} />
            </div>

            {isHr && department ? (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Team management
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false);
                        navigate(`/workforce/departments/${department.id}`);
                      }}
                    >
                      <Layers className="mr-2 h-4 w-4" aria-hidden="true" />
                      Manage teams
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false);
                        navigate(`/workforce/departments/${department.id}`);
                      }}
                    >
                      <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                      Manage team members
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-destructive/30 bg-destructive-soft/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-destructive">Danger zone</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Permanent deletion is only possible once every employee and team has been reassigned or removed.
                    Otherwise the department is archived: it disappears from active lists and filters while employees,
                    teams and every historical record are preserved.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="mt-3"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Delete department
                  </Button>
                </div>
              </div>
            ) : null}

            {submitError ? (
              <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {submitError}
              </p>
            ) : null}

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {department ? "Save changes" : "Create department"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${department?.name ?? "department"}?`}
        description={
          <div className="space-y-3">
            {deleteInfo ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Department code</dt>
                  <dd className="font-mono">{deleteInfo.code}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Team lead(s)</dt>
                  <dd>{deleteInfo.teamLeads.length ? deleteInfo.teamLeads.join(", ") : "None"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Employees</dt>
                  <dd className="tabular-nums">{deleteInfo.employees}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Teams</dt>
                  <dd className="tabular-nums">{deleteInfo.teams}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Checking the current state of this department…</p>
            )}
            <p className="text-sm text-foreground">
              {canDeletePermanently
                ? "This department is empty and can be deleted permanently. No employee, team or historical record is affected."
                : "This department still has employees or teams, so permanent deletion is not safe. It will be archived instead: it disappears from active tables, dropdowns and filters, while employees, teams and every attendance, performance, recruitment, risk and audit record are preserved."}
            </p>
          </div>
        }
        confirmLabel={canDeletePermanently ? "Delete permanently" : "Archive department"}
        destructive
        busy={runDelete.isPending}
        onConfirm={() => runDelete.mutate()}
      >
        {deleteError ? (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm text-destructive">
            {deleteError}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function DepartmentDetailSheet({
  department,
  onClose,
  onEdit,
  canEdit,
}: {
  department: DepartmentRow | null;
  onClose: () => void;
  onEdit: (department: Department) => void;
  canEdit: boolean;
}) {
  const active = department?.employees.filter((employee) => employee.status !== "exited") ?? [];
  const exited = department?.employees.filter((employee) => employee.status === "exited") ?? [];
  const head = useMemo(
    () => department?.employees.find((employee) => employee.id === department.head_employee_id) ?? null,
    [department],
  );

  const { data: health, isLoading } = useQuery({
    queryKey: ["department-health", department?.id],
    enabled: Boolean(department?.id),
    queryFn: async () => {
      const [signals, attendance, reviews] = await Promise.all([
        supabase.from("hr_signals").select("*").eq("entity_type", "department").eq("entity_id", department!.id),
        supabase.from("hr_attendance").select("status").in(
          "employee_id",
          department!.employees.map((employee) => employee.id),
        ),
        supabase.from("hr_performance_reviews").select("performance_score").in(
          "employee_id",
          department!.employees.map((employee) => employee.id),
        ),
      ]);
      if (signals.error) throw new Error(signals.error.message);
      const counted = (attendance.data ?? []).filter((record) =>
        ["present", "late", "half-day", "absent"].includes(record.status),
      );
      const credited = counted.reduce((total, record) => {
        if (record.status === "present") return total + 1;
        if (record.status === "late" || record.status === "half-day") return total + 0.5;
        return total;
      }, 0);
      const scores = (reviews.data ?? []).filter((review) => review.performance_score != null);
      return {
        signals: signals.data ?? [],
        attendanceRate: counted.length ? (credited / counted.length) * 100 : null,
        averagePerformance: scores.length
          ? scores.reduce((total, review) => total + Number(review.performance_score), 0) / scores.length
          : null,
      };
    },
  });

  const combined = health?.signals.find((signal) => signal.signal_type === "combined_risk");

  return (
    <Sheet open={Boolean(department)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto p-0 sm:max-w-xl">
        {department ? (
          <>
            <SheetHeader className="border-b border-border px-6 py-5 text-left">
              <SheetTitle className="text-lg">{department.name}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{department.code}</span>
                {department.description ? ` · ${department.description}` : ""}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {combined ? <RiskBadge score={combined.score} severity={combined.severity} /> : <ToneBadge tone="neutral">No signal</ToneBadge>}
                <ToneBadge tone={department.is_active ? "success" : "neutral"}>
                  {department.is_active ? "Active" : "Inactive"}
                </ToneBadge>
              </div>
            </SheetHeader>

            <div className="space-y-4 px-6 py-5">
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Department head</dt>
                  <dd className="mt-0.5 text-sm">{head?.full_name ?? "Not assigned"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Capacity</dt>
                  <dd className="mt-0.5 text-sm tabular-nums">{department.capacity ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Total employees</dt>
                  <dd className="mt-0.5 text-sm tabular-nums">{department.employees.length}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Active / exited</dt>
                  <dd className="mt-0.5 text-sm tabular-nums">
                    {active.length} / {exited.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Open requisitions</dt>
                  <dd className="mt-0.5 text-sm tabular-nums">{department.openRequisitions}</dd>
                </div>
              </dl>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Attendance health</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {isLoading ? "…" : formatPercent(health?.attendanceRate ?? null)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Performance health</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {isLoading ? "…" : formatScore(health?.averagePerformance ?? null)}
                  </p>
                </div>
              </div>

              <section className="rounded-lg border border-border bg-card">
                <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Department signals
                </h3>
                {isLoading ? (
                  <div className="p-4">
                    <TableSkeleton rows={3} columns={3} />
                  </div>
                ) : (health?.signals ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">No risk signal computed for this department.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {health!.signals.map((signal) => (
                      <li key={signal.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">{signal.signal_type.replace(/_/g, " ")}</p>
                          <p className="truncate text-xs text-muted-foreground">{signal.explanation}</p>
                        </div>
                        <RiskBadge score={signal.score} severity={signal.severity} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card">
                <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Team ({active.length})
                </h3>
                <ul className="divide-y divide-border">
                  {active.slice(0, 12).map((employee) => (
                    <li key={employee.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{employee.full_name}</p>
                        <p className="text-xs text-muted-foreground">{employee.job_title ?? "—"}</p>
                      </div>
                      <ToneBadge tone="neutral">{employee.work_mode}</ToneBadge>
                    </li>
                  ))}
                </ul>
              </section>

              {canEdit ? (
                <Button variant="outline" size="sm" onClick={() => onEdit(department)}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                  Edit department
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
