import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarCheck, CalendarX, Clock, Plane, TrendingDown, Users } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AttendanceImportPanel } from "@/components/attendance/attendance-import-panel";
import { supabase } from "@/lib/db";
import { useDepartmentOptions } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useGlobalFilters } from "@/providers/filter-provider";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate, formatPercent } from "@/lib/format";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  type AttendanceRecord,
  type AttendanceStatus,
  type Employee,
} from "@/lib/types";
import { CHART_COLORS, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

interface EmployeeAttendanceSummary {
  employee: Employee;
  total: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  rate: number | null;
}

export default function AttendancePage() {
  const { openEmployee360 } = useEmployee360();
  const { departmentId, from, to, days, teamId } = useGlobalFilters();
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (searchParams.get("import") ? "import" : "dashboard"));
  const { options: departmentOptions } = useDepartmentOptions();

  useRealtimeRefresh(["hr_attendance", "hr_attendance_imports"], [["attendance"]], "hr-attendance");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["attendance", departmentId, from, to],
    queryFn: async () => {
      const [employees, attendance] = await Promise.all([
        supabase.from("hr_employees").select("id, full_name, code, department_id, status, work_mode").limit(1000),
        supabase
          .from("hr_attendance")
          .select("*")
          .gte("attendance_date", from)
          .lte("attendance_date", to)
          .order("attendance_date", { ascending: false })
          .limit(20000),
      ]);
      if (employees.error) throw new Error(employees.error.message);
      if (attendance.error) throw new Error(attendance.error.message);
      return {
        employees: (employees.data ?? []) as Employee[],
        attendance: (attendance.data ?? []) as AttendanceRecord[],
      };
    },
  });

  const scopedEmployees = useMemo(() => {
    const employees = data?.employees ?? [];
    const byDepartment =
      departmentId === "all" ? employees : employees.filter((employee) => employee.department_id === departmentId);
    return teamId === "all" ? byDepartment : byDepartment.filter((employee) => employee.team_id === teamId);
  }, [data?.employees, departmentId, teamId]);

  const scopedIds = useMemo(() => new Set(scopedEmployees.map((employee) => employee.id)), [scopedEmployees]);

  const scopedAttendance = useMemo(
    () => (data?.attendance ?? []).filter((record) => scopedIds.has(record.employee_id)),
    [data?.attendance, scopedIds],
  );

  const latestDate = useMemo(() => {
    const dates = scopedAttendance.map((record) => record.attendance_date);
    return dates.length > 0 ? dates.sort().at(-1)! : null;
  }, [scopedAttendance]);

  const metrics = useMemo(() => {
    const dayRecords = latestDate ? scopedAttendance.filter((record) => record.attendance_date === latestDate) : [];
    const dayCount = (status: AttendanceStatus) => dayRecords.filter((record) => record.status === status).length;

    const counted = scopedAttendance.filter((record) =>
      ["present", "late", "half-day", "absent"].includes(record.status),
    );
    const credited = counted.reduce((total, record) => {
      if (record.status === "present") return total + 1;
      if (record.status === "late" || record.status === "half-day") return total + 0.5;
      return total;
    }, 0);
    const rate = counted.length > 0 ? (credited / counted.length) * 100 : null;

    const byDate = new Map<string, { credited: number; total: number }>();
    counted.forEach((record) => {
      if (!byDate.has(record.attendance_date)) byDate.set(record.attendance_date, { credited: 0, total: 0 });
      const entry = byDate.get(record.attendance_date)!;
      entry.total += 1;
      if (record.status === "present") entry.credited += 1;
      else if (record.status === "late" || record.status === "half-day") entry.credited += 0.5;
    });
    const trend = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({ date, rate: entry.total ? Math.round((entry.credited / entry.total) * 1000) / 10 : 0 }));

    const departmentComparison = departmentOptions
      .map((option) => {
        const ids = new Set(
          (data?.employees ?? []).filter((employee) => employee.department_id === option.value).map((employee) => employee.id),
        );
        const records = (data?.attendance ?? []).filter(
          (record) => ids.has(record.employee_id) && ["present", "late", "half-day", "absent"].includes(record.status),
        );
        const departmentCredited = records.reduce((total, record) => {
          if (record.status === "present") return total + 1;
          if (record.status === "late" || record.status === "half-day") return total + 0.5;
          return total;
        }, 0);
        return {
          name: option.label,
          rate: records.length ? Math.round((departmentCredited / records.length) * 1000) / 10 : 0,
        };
      })
      .filter((entry) => entry.rate > 0)
      .sort((a, b) => a.rate - b.rate);

    const summaries: EmployeeAttendanceSummary[] = scopedEmployees.map((employee) => {
      const records = scopedAttendance.filter(
        (record) => record.employee_id === employee.id && ["present", "late", "half-day", "absent", "leave"].includes(record.status),
      );
      const employeeCredited = records.reduce((total, record) => {
        if (record.status === "present") return total + 1;
        if (record.status === "late" || record.status === "half-day") return total + 0.5;
        return total;
      }, 0);
      return {
        employee,
        total: records.length,
        present: records.filter((record) => record.status === "present").length,
        late: records.filter((record) => record.status === "late").length,
        absent: records.filter((record) => record.status === "absent").length,
        leave: records.filter((record) => record.status === "leave").length,
        rate: records.length ? (employeeCredited / records.length) * 100 : null,
      };
    });

    const lowAttendance = summaries
      .filter((summary) => summary.rate != null && summary.total >= 5 && summary.rate < 85)
      .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));

    const exceptions = scopedAttendance
      .filter((record) => record.status === "late" || record.status === "absent")
      .slice(0, 40)
      .map((record) => ({
        record,
        employee: scopedEmployees.find((employee) => employee.id === record.employee_id) ?? null,
      }));

    return {
      presentToday: dayCount("present"),
      absentToday: dayCount("absent"),
      lateToday: dayCount("late"),
      leaveToday: dayCount("leave"),
      rate,
      trend,
      departmentComparison,
      summaries,
      lowAttendance,
      exceptions,
      dayRecords: dayRecords.length,
    };
  }, [data?.attendance, data?.employees, departmentOptions, latestDate, scopedAttendance, scopedEmployees]);

  const employeeColumns: Column<EmployeeAttendanceSummary>[] = [
    {
      key: "employee",
      header: "Employee",
      sortValue: (row) => row.employee.full_name,
      cell: (row) => (
        <button type="button" className="min-w-0 text-left hover:text-primary" onClick={() => openEmployee360(row.employee.id)}>
          <p className="truncate font-medium">{row.employee.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.employee.code}</p>
        </button>
      ),
    },
    { key: "total", header: "Days", align: "right", sortValue: (row) => row.total, cell: (row) => <span className="tabular-nums">{row.total}</span> },
    { key: "present", header: "Present", align: "right", sortValue: (row) => row.present, cell: (row) => <span className="tabular-nums">{row.present}</span>, hideBelow: "sm" },
    { key: "late", header: "Late", align: "right", sortValue: (row) => row.late, cell: (row) => <span className="tabular-nums">{row.late}</span>, hideBelow: "sm" },
    { key: "absent", header: "Absent", align: "right", sortValue: (row) => row.absent, cell: (row) => <span className="tabular-nums">{row.absent}</span>, hideBelow: "md" },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      sortValue: (row) => row.rate ?? 0,
      cell: (row) => (
        <ToneBadge tone={row.rate == null ? "neutral" : row.rate >= 90 ? "success" : row.rate >= 80 ? "warning" : "critical"}>
          {formatPercent(row.rate)}
        </ToneBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => openEmployee360(row.employee.id)}>
          Open 360°
        </Button>
      ),
    },
  ];

  const exceptionColumns: Column<{ record: AttendanceRecord; employee: Employee | null }>[] = [
    {
      key: "employee",
      header: "Employee",
      sortValue: (row) => row.employee?.full_name ?? "",
      cell: (row) => (
        <button type="button" className="min-w-0 text-left hover:text-primary" onClick={() => row.employee && openEmployee360(row.employee.id)}>
          <p className="truncate font-medium">{row.employee?.full_name ?? "Unknown"}</p>
          <p className="truncate text-xs text-muted-foreground">{row.employee?.code ?? "—"}</p>
        </button>
      ),
    },
    {
      key: "date",
      header: "Date",
      sortValue: (row) => row.record.attendance_date,
      cell: (row) => <span className="text-sm tabular-nums">{formatDate(row.record.attendance_date)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.record.status,
      cell: (row) => (
        <StatusBadge
          value={row.record.status}
          labels={ATTENDANCE_STATUS_LABELS}
          tones={ATTENDANCE_STATUS_TONE}
          showIcon
        />
      ),
    },
    {
      key: "notes",
      header: "Notes",
      cell: (row) => <span className="text-xs text-muted-foreground">{row.record.notes ?? "—"}</span>,
      hideBelow: "md",
    },
  ];

  const rangeLabel = days > 0 ? `Last ${days} days` : `${formatDate(from)} – ${formatDate(to)}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description={`Import biometric exports, validate every row, and monitor attendance health. Window: ${rangeLabel}.`}
        breadcrumbs={[{ label: "Attendance" }]}
        actions={isHr ? <ToneBadge tone="workflow">HR import access</ToneBadge> : <ToneBadge tone="insight">Read-only access</ToneBadge>}
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          if (value !== "import" && searchParams.get("import")) {
            const next = new URLSearchParams(searchParams);
            next.delete("import");
            setSearchParams(next, { replace: true });
          }
        }}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          {isHr ? <TabsTrigger value="import">Import center</TabsTrigger> : null}
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="employees">Employee table</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-5">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            loadingFallback={
              <div className="space-y-5">
                <CardSkeleton count={5} />
                <ChartSkeleton />
              </div>
            }
          >
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard
                label="Present"
                value={metrics.presentToday}
                icon={CalendarCheck}
                tone="success"
                hint={latestDate ? `On ${formatDate(latestDate)}` : "No records"}
              />
              <KpiCard label="Absent" value={metrics.absentToday} icon={CalendarX} tone="critical" hint={latestDate ? formatDate(latestDate) : "—"} />
              <KpiCard label="Late" value={metrics.lateToday} icon={Clock} tone="warning" hint={latestDate ? formatDate(latestDate) : "—"} />
              <KpiCard label="On leave" value={metrics.leaveToday} icon={Plane} tone="info" hint={latestDate ? formatDate(latestDate) : "—"} />
              <KpiCard
                label="Attendance rate"
                value={formatPercent(metrics.rate)}
                icon={Users}
                tone={metrics.rate != null && metrics.rate < 85 ? "warning" : "primary"}
                hint={rangeLabel}
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Attendance trend"
                description={`Daily attendance rate · ${rangeLabel}`}
                summary={`Attendance rate per working day. Latest value ${metrics.trend.at(-1)?.rate ?? 0} percent.`}
              >
                {metrics.trend.length === 0 ? (
                  <EmptyState title="No attendance in this window" description="Import an attendance file to populate the trend." />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={metrics.trend}>
                      <defs>
                        <linearGradient id="attendanceArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.workflow} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={CHART_COLORS.workflow} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridStyle} />
                      <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} {...axisStyle} />
                      <YAxis domain={[0, 100]} unit="%" {...axisStyle} width={40} />
                      <Tooltip {...tooltipStyle} formatter={(value: number) => [`${value}%`, "Attendance"]} />
                      <Area type="monotone" dataKey="rate" stroke={CHART_COLORS.workflow} strokeWidth={2} fill="url(#attendanceArea)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard
                title="Department comparison"
                description="Attendance rate by department over the selected window"
                summary={metrics.departmentComparison.map((entry) => `${entry.name} ${entry.rate}%`).join(", ") + "."}
              >
                {metrics.departmentComparison.length === 0 ? (
                  <EmptyState title="No department data" description="Attendance records are needed to compare departments." />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={metrics.departmentComparison} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid {...gridStyle} horizontal={false} vertical />
                      <XAxis type="number" domain={[0, 100]} unit="%" {...axisStyle} />
                      <YAxis type="category" dataKey="name" width={92} {...axisStyle} />
                      <Tooltip {...tooltipStyle} formatter={(value: number) => [`${value}%`, "Attendance"]} />
                      <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                        {metrics.departmentComparison.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={entry.rate >= 90 ? CHART_COLORS.success : entry.rate >= 80 ? CHART_COLORS.warning : CHART_COLORS.critical}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            <section className="space-y-3">
              <SectionHeader
                title="Low-attendance employees"
                description="Below 85% attendance across the selected window (minimum five recorded days)"
              />
              {metrics.lowAttendance.length === 0 ? (
                <EmptyState
                  title="No low-attendance employees"
                  description="Every employee with enough recorded days is at or above 85% attendance."
                  icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
                />
              ) : (
                <DataTable
                  columns={employeeColumns}
                  rows={metrics.lowAttendance.slice(0, 12)}
                  getRowId={(row) => row.employee.id}
                  pageSize={8}
                  caption="Low-attendance employees"
                />
              )}
            </section>
          </QueryState>
        </TabsContent>

        {isHr ? (
          <TabsContent value="import">
            <AttendanceImportPanel />
          </TabsContent>
        ) : null}

        <TabsContent value="exceptions" className="space-y-4">
          <SectionHeader
            title="Attendance exceptions"
            description="Late and absent records captured in the selected window"
          />
          <DataTable
            columns={exceptionColumns}
            rows={metrics.exceptions}
            getRowId={(row) => row.record.id}
            pageSize={12}
            caption="Attendance exceptions"
            isLoading={isLoading}
            emptyState={
              <EmptyState
                title="No attendance exceptions"
                description="No late or absent records were found in this window."
              />
            }
          />
        </TabsContent>

        <TabsContent value="employees" className="space-y-4">
          <SectionHeader
            title="Employee attendance"
            description="Per-employee attendance summary. Select a row to open the shared Employee 360° view."
          />
          <DataTable
            columns={employeeColumns}
            rows={metrics.summaries.filter((summary) => summary.total > 0)}
            getRowId={(row) => row.employee.id}
            initialSort={{ key: "rate", direction: "asc" }}
            pageSize={15}
            caption="Employee attendance summary"
            isLoading={isLoading}
            emptyState={
              <EmptyState title="No attendance records" description="Import an attendance file to populate this table." />
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
