import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, UserMinus, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState, QueryState } from "@/components/shared/states";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ClearFiltersButton, FilterBar, SearchInput, SelectFilter } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeeFormDialog } from "@/components/forms/employee-form-dialog";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useDepartmentOptions, useTeamNameMap, useTeamOptions } from "@/hooks/use-lookups";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { useAuth } from "@/providers/auth-provider";
import { supabase } from "@/lib/db";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYEE_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_OPTIONS,
  EMPLOYMENT_TYPE_TONE,
  WORK_MODE_LABELS,
  WORK_MODE_OPTIONS,
  WORK_MODE_TONE,
  type Employee,
} from "@/lib/types";

export default function WorkforceEmployeesPage() {
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
  const [workMode, setWorkMode] = useState("all");
  const [employmentType, setEmploymentType] = useState("all");
  const [location, setLocation] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [exiting, setExiting] = useState<Employee | null>(null);
  const [exitDate, setExitDate] = useState(new Date().toISOString().slice(0, 10));

  // Team options depend on the selected department and must be declared after it.
  const { options: teamOptions } = useTeamOptions(department === "all" ? null : department);
  const teamName = useTeamNameMap();

  useRealtimeRefresh(["hr_employees"], [["workforce-employees"]]);

  const { data: employees = [], isLoading, isError, refetch } = useQuery<Employee[]>({
    queryKey: ["workforce-employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").order("full_name").limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  // Deep links from the quick action menu and global search.
  useEffect(() => {
    if (searchParams.get("new") === "1" && isHr) {
      setEditing(null);
      setFormOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    } else if (searchParams.get("employee")) {
      openEmployee360(searchParams.get("employee")!);
      const next = new URLSearchParams(searchParams);
      next.delete("employee");
      setSearchParams(next, { replace: true });
    }
  }, [openEmployee360, isHr, searchParams, setSearchParams]);

  const locations = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.location).filter(Boolean) as string[])).sort(),
    [employees],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (department !== "all" && employee.department_id !== department) return false;
      if (team !== "all" && employee.team_id !== team) return false;
      if (status !== "all" && employee.status !== status) return false;
      if (workMode !== "all" && employee.work_mode !== workMode) return false;
      if (employmentType !== "all" && employee.employment_type !== employmentType) return false;
      if (location !== "all" && employee.location !== location) return false;
      if (!term) return true;
      return (
        employee.full_name.toLowerCase().includes(term) ||
        employee.code.toLowerCase().includes(term) ||
        (employee.work_email ?? "").toLowerCase().includes(term) ||
        (employee.job_title ?? "").toLowerCase().includes(term)
      );
    });
  }, [department, employees, employmentType, location, search, status, team, workMode]);

  const departmentName = useMemo(() => {
    const map = new Map(departmentOptions.map((option) => [option.value, option.label]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [departmentOptions]);

  const markExited = useMutation({
    mutationFn: async (employee: Employee) => {
      const before = { status: employee.status, exit_date: employee.exit_date };
      const { error } = await supabase
        .from("hr_employees")
        .update({ status: "exited", exit_date: exitDate })
        .eq("id", employee.id);
      if (error) throw new Error(error.message);
      await supabase.from("hr_audit_log").insert({
        actor_id: profile?.user_id ?? null,
        actor_email: profile?.email ?? null,
        entity_type: "employee",
        entity_id: employee.id,
        action: "employee_exited",
        before_json: before,
        after_json: { status: "exited", exit_date: exitDate },
      });
    },
    onSuccess: () => {
      toast.success("Employee marked as exited. Analytics updated.");
      setExiting(null);
      void queryClient.invalidateQueries({ queryKey: ["workforce-employees"] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hasFilters =
    Boolean(search) || department !== "all" || team !== "all" || status !== "all" || workMode !== "all" || employmentType !== "all" || location !== "all";

  const columns: Column<Employee>[] = [
    {
      key: "full_name",
      header: "Employee",
      sortValue: (row) => row.full_name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.code}</span> · {row.job_title ?? "—"}
          </p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      sortValue: (row) => departmentName(row.department_id),
      cell: (row) => <span className="text-sm">{departmentName(row.department_id)}</span>,
      hideBelow: "md",
    },
    {
      key: "team",
      header: "Team",
      sortValue: (row) => teamName.get(row.team_id ?? "") ?? "",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.team_id ? teamName.get(row.team_id) ?? "—" : "—"}</span>
      ),
      hideBelow: "lg",
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => (
        <StatusBadge value={row.status} labels={EMPLOYEE_STATUS_LABELS} tones={EMPLOYEE_STATUS_TONE} />
      ),
    },
    {
      key: "work_mode",
      header: "Work mode",
      sortValue: (row) => row.work_mode,
      cell: (row) => <StatusBadge value={row.work_mode} labels={WORK_MODE_LABELS} tones={WORK_MODE_TONE} />,
      hideBelow: "lg",
    },
    {
      key: "employment_type",
      header: "Type",
      sortValue: (row) => row.employment_type,
      cell: (row) => (
        <StatusBadge value={row.employment_type} labels={EMPLOYMENT_TYPE_LABELS} tones={EMPLOYMENT_TYPE_TONE} />
      ),
      hideBelow: "lg",
    },
    {
      key: "joining_date",
      header: "Joined",
      sortValue: (row) => row.joining_date ?? "",
      cell: (row) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.joining_date)}</span>,
      hideBelow: "md",
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${row.full_name}`} onClick={() => openEmployee360(row.id)}>
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          {isHr ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${row.full_name}`}
                onClick={() => {
                  setEditing(row);
                  setFormOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              {row.status !== "exited" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Mark ${row.full_name} as exited`}
                  onClick={() => {
                    setExiting(row);
                    setExitDate(new Date().toISOString().slice(0, 10));
                  }}
                >
                  <UserMinus className="h-4 w-4 text-destructive" aria-hidden="true" />
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employee directory"
        description="Master workforce records that every other module references."
        breadcrumbs={[{ label: "Workforce", to: "/workforce/employees" }, { label: "Employees" }]}
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
              Add employee
            </Button>
          ) : (
            <ToneBadge tone="insight">Read-only access</ToneBadge>
          )
        }
      />

      {!isHr ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Founder/CEO accounts have read-focused access. Workforce changes are performed by the HR role and enforced on
          the backend.
        </p>
      ) : null}

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, email, title…" />
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
          label="Status"
          value={status}
          onChange={setStatus}
          options={EMPLOYEE_STATUS_OPTIONS.map((option) => ({ value: option, label: EMPLOYEE_STATUS_LABELS[option] }))}
        />
        <SelectFilter
          label="Work mode"
          value={workMode}
          onChange={setWorkMode}
          options={WORK_MODE_OPTIONS.map((option) => ({ value: option, label: WORK_MODE_LABELS[option] }))}
        />
        <SelectFilter
          label="Employment type"
          value={employmentType}
          onChange={setEmploymentType}
          options={EMPLOYMENT_TYPE_OPTIONS.map((option) => ({ value: option, label: EMPLOYMENT_TYPE_LABELS[option] }))}
        />
        <SelectFilter
          label="Location"
          value={location}
          onChange={setLocation}
          options={locations.map((option) => ({ value: option, label: option }))}
          allLabel="All locations"
        />
        <ClearFiltersButton
          visible={hasFilters}
          onClick={() => {
            setSearch("");
            setDepartment("all");
            setTeam("all");
            setStatus("all");
            setWorkMode("all");
            setEmploymentType("all");
            setLocation("all");
          }}
        />
      </FilterBar>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No employees match these filters"
        emptyDescription="Adjust the filters or add a new employee record."
      >
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          initialSort={{ key: "full_name", direction: "asc" }}
          pageSize={15}
          caption="Employee directory"
          emptyState={
            <EmptyState
              title="No employees yet"
              description="Add the first employee record to start building the workforce."
              icon={<Users className="h-5 w-5" aria-hidden="true" />}
              action={
                isHr ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add employee
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </QueryState>

      <EmployeeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        employee={editing}
        onSaved={(employee, mode) => {
          toast.success(mode === "created" ? `${employee.full_name} was created.` : "Employee updated.");
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ["workforce-employees"] });
          void queryClient.invalidateQueries({ queryKey: ["employees"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />

      <ConfirmDialog
        open={Boolean(exiting)}
        onOpenChange={(open) => (!open ? setExiting(null) : undefined)}
        title={`Mark ${exiting?.full_name ?? "employee"} as exited?`}
        description="This records an exit date, updates workforce analytics and is written to the audit log. The record is retained so historical attendance and performance stay intact."
        confirmLabel="Mark as exited"
        destructive
        busy={markExited.isPending}
        onConfirm={() => exiting && markExited.mutate(exiting)}
      >
        <div className="space-y-1.5">
          <Label htmlFor="exit-date" className="text-xs font-medium text-muted-foreground">
            Exit date
          </Label>
          <Input id="exit-date" type="date" value={exitDate} onChange={(event) => setExitDate(event.target.value)} />
        </div>
      </ConfirmDialog>
    </div>
  );
}
