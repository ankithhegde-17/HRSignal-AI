import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarRange, UserMinus, UserCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { QueryState, CardSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/db";
import { useDepartmentOptions } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate } from "@/lib/format";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  type Employee,
  type EmployeeStatus,
} from "@/lib/types";

type ExitWindow = "all" | "30" | "90" | "180" | "365" | "custom";

const EXIT_WINDOWS: Array<{ value: ExitWindow; label: string }> = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 3 months" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export default function WorkforceStatusPage() {
  const { openEmployee360 } = useEmployee360();
  const { options: departmentOptions } = useDepartmentOptions();
  const [statusFilter, setStatusFilter] = useState<EmployeeStatus | "all">("all");
  const [exitWindow, setExitWindow] = useState<ExitWindow>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [department, setDepartment] = useState("all");

  useRealtimeRefresh(["hr_employees"], [["workforce-status"]]);

  const { data: employees = [], isLoading, isError, refetch } = useQuery<Employee[]>({
    queryKey: ["workforce-status"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").order("full_name").limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  const counts = useMemo(() => {
    const byStatus = (status: EmployeeStatus) => employees.filter((employee) => employee.status === status).length;
    return {
      active: byStatus("active"),
      notice: byStatus("notice period"),
      leave: byStatus("on leave"),
      exited: byStatus("exited"),
    };
  }, [employees]);

  const filtered = useMemo(() => {
    const now = new Date();
    return employees.filter((employee) => {
      if (statusFilter !== "all" && employee.status !== statusFilter) return false;
      if (department !== "all" && employee.department_id !== department) return false;

      if (employee.status !== "exited") return true;

      if (exitWindow === "all") return true;
      if (!employee.exit_date) return false;

      if (exitWindow === "custom") {
        if (customFrom && employee.exit_date < customFrom) return false;
        if (customTo && employee.exit_date > customTo) return false;
        return true;
      }

      const days = Number(exitWindow);
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      return employee.exit_date >= cutoff.toISOString().slice(0, 10);
    });
  }, [customFrom, customTo, department, employees, exitWindow, statusFilter]);

  const departmentName = useMemo(() => {
    const map = new Map(departmentOptions.map((option) => [option.value, option.label]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [departmentOptions]);

  const columns: Column<Employee>[] = [
    {
      key: "full_name",
      header: "Employee",
      sortValue: (row) => row.full_name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.code}</span> · {departmentName(row.department_id)}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => <StatusBadge value={row.status} labels={EMPLOYEE_STATUS_LABELS} tones={EMPLOYEE_STATUS_TONE} showIcon />,
    },
    {
      key: "employment_type",
      header: "Type",
      sortValue: (row) => row.employment_type,
      cell: (row) => <span className="text-sm">{EMPLOYMENT_TYPE_LABELS[row.employment_type]}</span>,
      hideBelow: "md",
    },
    {
      key: "joining_date",
      header: "Joined",
      sortValue: (row) => row.joining_date ?? "",
      cell: (row) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.joining_date)}</span>,
      hideBelow: "md",
    },
    {
      key: "exit_date",
      header: "Exited",
      sortValue: (row) => row.exit_date ?? "",
      cell: (row) => (
        <span className="text-sm tabular-nums text-muted-foreground">{row.exit_date ? formatDate(row.exit_date) : "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => openEmployee360(row.id)}>
          Open 360°
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employee status"
        description="Active, notice period, on leave and exited populations with exit-date windows."
        breadcrumbs={[{ label: "Workforce", to: "/workforce/employees" }, { label: "Employee Status" }]}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={<CardSkeleton count={4} />}
      >
        <section aria-label="Employee status summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Active"
            value={counts.active}
            icon={UserCheck}
            tone="success"
            onClick={() => setStatusFilter("active")}
            hint="Currently working"
          />
          <KpiCard
            label="Notice period"
            value={counts.notice}
            icon={CalendarRange}
            tone="warning"
            onClick={() => setStatusFilter("notice period")}
            hint="Retention risk window"
          />
          <KpiCard
            label="On leave"
            value={counts.leave}
            icon={Activity}
            tone="info"
            onClick={() => setStatusFilter("on leave")}
            hint="Approved leave"
          />
          <KpiCard
            label="Exited"
            value={counts.exited}
            icon={UserMinus}
            tone="neutral"
            onClick={() => setStatusFilter("exited")}
            hint="Retained for history"
          />
        </section>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-card lg:flex-row lg:flex-wrap lg:items-end">
          <div className="flex w-full flex-col gap-1.5 sm:w-44">
            <Label className="text-xs font-medium text-muted-foreground">Status</Label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as EmployeeStatus | "all")}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All statuses</option>
              {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((status) => (
                <option key={status} value={status}>
                  {EMPLOYEE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex w-full flex-col gap-1.5 sm:w-44">
            <Label className="text-xs font-medium text-muted-foreground">Department</Label>
            <select
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All departments</option>
              {departmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex w-full flex-col gap-1.5 sm:w-52">
            <Label className="text-xs font-medium text-muted-foreground">Exit date window</Label>
            <select
              value={exitWindow}
              onChange={(event) => setExitWindow(event.target.value as ExitWindow)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {EXIT_WINDOWS.map((window) => (
                <option key={window.value} value={window.value}>
                  {window.label}
                </option>
              ))}
            </select>
          </div>

          {exitWindow === "custom" ? (
            <div className="flex w-full flex-col gap-1.5 sm:w-auto">
              <Label className="text-xs font-medium text-muted-foreground">Custom exit range</Label>
              <div className="flex items-center gap-2">
                <Input type="date" aria-label="Exited from" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="sm:w-40" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" aria-label="Exited to" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="sm:w-40" />
              </div>
            </div>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="sm:ml-auto"
            onClick={() => {
              setStatusFilter("all");
              setDepartment("all");
              setExitWindow("all");
              setCustomFrom("");
              setCustomTo("");
            }}
          >
            Clear filters
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          initialSort={{ key: "status", direction: "asc" }}
          pageSize={15}
          caption="Employees by status"
          emptyState={
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Users className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold">No employees in this view</h3>
              <p className="mt-1 text-sm text-muted-foreground">Adjust the status, department or exit-date window.</p>
            </div>
          }
        />
      </QueryState>
    </div>
  );
}
