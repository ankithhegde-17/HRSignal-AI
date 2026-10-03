import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Building2, HeartPulse, TrendingDown, Users } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RiskBadge, ToneBadge } from "@/components/shared/badges";
import { supabase } from "@/lib/db";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { useGlobalFilters } from "@/providers/filter-provider";
import { formatPercent, formatScore } from "@/lib/format";
import { WORK_MODE_LABELS, type WorkMode } from "@/lib/types";
import { CHART_COLORS, CHART_SERIES, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

const MODE_COLORS: Record<WorkMode, string> = {
  onsite: CHART_COLORS.primary,
  remote: CHART_COLORS.insight,
  hybrid: CHART_COLORS.workflow,
};

const BANDS = [
  { label: "0–39", min: 0, max: 39.999 },
  { label: "40–59", min: 40, max: 59.999 },
  { label: "60–79", min: 60, max: 79.999 },
  { label: "80–100", min: 80, max: 100 },
];

interface DepartmentHealthRow {
  id: string;
  name: string;
  headcount: number;
  capacity: number | null;
  attendanceRate: number | null;
  averagePerformance: number | null;
  combinedRisk: number | null;
  severity: string | null;
  overCapacity: boolean;
}

export default function ExecutiveWorkforceHealthPage() {
  const { teamId } = useGlobalFilters();
  useRealtimeRefresh(
    ["hr_employees", "hr_attendance", "hr_performance_reviews", "hr_signals"],
    [["exec-workforce-health"]],
    "hr-exec-health",
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["exec-workforce-health"],
    queryFn: async () => {
      const [employees, departments, attendance, reviews, signals] = await Promise.all([
        supabase.from("hr_employees").select("id, department_id, status, work_mode, joining_date, exit_date").limit(2000),
        supabase.from("hr_departments").select("id, name, capacity").eq("is_active", true).order("name"),
        supabase.from("hr_attendance").select("employee_id, status").limit(20000),
        supabase.from("hr_performance_reviews").select("employee_id, performance_score, period_end, status").order("period_end", { ascending: false }).limit(5000),
        supabase.from("hr_signals").select("*").limit(1000),
      ]);
      const firstError = [employees, departments, attendance, reviews, signals].find((result) => result.error)?.error;
      if (firstError) throw new Error(firstError.message);
      return {
        employees: employees.data ?? [],
        departments: departments.data ?? [],
        attendance: attendance.data ?? [],
        reviews: reviews.data ?? [],
        signals: signals.data ?? [],
      };
    },
  });

  const metrics = useMemo(() => {
    const employees = data?.employees ?? [];
    const activeAll = employees.filter((employee) => employee.status !== "exited");
    const active = teamId === "all" ? activeAll : activeAll.filter((employee) => employee.team_id === teamId);
    const notice = employees.filter((employee) => employee.status === "notice period");
    const exited = employees.filter((employee) => employee.status === "exited");

    const attritionRate = employees.length ? (exited.length / employees.length) * 100 : null;

    const memberIds = new Set(active.map((employee) => employee.id));
    const counted = (data?.attendance ?? []).filter(
      (record) => memberIds.has(record.employee_id) && ["present", "late", "half-day", "absent"].includes(record.status),
    );
    const credited = counted.reduce((total, record) => {
      if (record.status === "present") return total + 1;
      if (record.status === "late" || record.status === "half-day") return total + 0.5;
      return total;
    }, 0);
    const attendanceRate = counted.length ? (credited / counted.length) * 100 : null;

    const latestByEmployee = new Map<string, number>();
    (data?.reviews ?? [])
      .filter((review) => review.status !== "draft" && review.performance_score != null && memberIds.has(review.employee_id))
      .forEach((review) => {
        if (!latestByEmployee.has(review.employee_id)) latestByEmployee.set(review.employee_id, Number(review.performance_score));
      });
    const scores = Array.from(latestByEmployee.values());
    const averagePerformance = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null;

    const distribution = BANDS.map((band) => ({
      label: band.label,
      count: scores.filter((score) => score >= band.min && score <= band.max).length,
    }));

    const workModes = (["onsite", "remote", "hybrid"] as WorkMode[]).map((mode) => ({
      mode,
      label: WORK_MODE_LABELS[mode],
      count: active.filter((employee) => employee.work_mode === mode).length,
    }));

    // Headcount movement by month
    const months: string[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 17; i >= 0; i -= 1) {
      const d = new Date(cursor);
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const movement = months.map((month) => ({
      month,
      joins: employees.filter((employee) => employee.joining_date?.slice(0, 7) === month).length,
      exits: employees.filter((employee) => employee.exit_date?.slice(0, 7) === month).length,
    }));

    const departmentHealth: DepartmentHealthRow[] = (data?.departments ?? []).map((department) => {
      const members = active.filter((employee) => employee.department_id === department.id);
      const ids = new Set(members.map((member) => member.id));
      const departmentAttendance = counted.filter((record) => ids.has(record.employee_id));
      const departmentCredited = departmentAttendance.reduce((total, record) => {
        if (record.status === "present") return total + 1;
        if (record.status === "late" || record.status === "half-day") return total + 0.5;
        return total;
      }, 0);
      const departmentScores = members
        .map((member) => latestByEmployee.get(member.id))
        .filter((score): score is number => score != null);
      const signal = (data?.signals ?? []).find(
        (item) => item.entity_type === "department" && item.entity_id === department.id && item.signal_type === "combined_risk",
      );
      return {
        id: department.id,
        name: department.name,
        headcount: members.length,
        capacity: department.capacity,
        attendanceRate: departmentAttendance.length ? (departmentCredited / departmentAttendance.length) * 100 : null,
        averagePerformance: departmentScores.length
          ? departmentScores.reduce((total, score) => total + score, 0) / departmentScores.length
          : null,
        combinedRisk: signal ? Number(signal.score) : null,
        severity: signal?.severity ?? null,
        overCapacity: department.capacity != null && members.length > department.capacity,
      };
    }).sort((a, b) => (b.combinedRisk ?? 0) - (a.combinedRisk ?? 0));

    return {
      headcount: employees.length,
      active: active.length,      notice: notice.length,
      exited: exited.length,
      attritionRate,
      attendanceRate,
      averagePerformance,
      distribution,
      workModes,
      movement,
      departmentHealth,
      overCapacity: departmentHealth.filter((row) => row.overCapacity),
    };
  }, [data, teamId]);

  const columns: Column<DepartmentHealthRow>[] = [
    { key: "name", header: "Department", sortValue: (row) => row.name, cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: "headcount", header: "Headcount", align: "right", sortValue: (row) => row.headcount, cell: (row) => <span className="tabular-nums">{row.headcount}</span> },
    {
      key: "capacity",
      header: "Capacity",
      align: "right",
      sortValue: (row) => row.capacity ?? 0,
      cell: (row) => (
        <span className={`tabular-nums ${row.overCapacity ? "font-medium text-destructive" : ""}`}>
          {row.capacity ?? "—"}
        </span>
      ),
      hideBelow: "sm",
    },
    {
      key: "attendanceRate",
      header: "Attendance",
      align: "right",
      sortValue: (row) => row.attendanceRate ?? -1,
      cell: (row) => (
        <ToneBadge tone={row.attendanceRate == null ? "neutral" : row.attendanceRate >= 90 ? "success" : row.attendanceRate >= 80 ? "warning" : "critical"}>
          {formatPercent(row.attendanceRate)}
        </ToneBadge>
      ),
    },
    {
      key: "averagePerformance",
      header: "Performance",
      align: "right",
      sortValue: (row) => row.averagePerformance ?? -1,
      cell: (row) => <span className="tabular-nums">{formatScore(row.averagePerformance)}</span>,
      hideBelow: "md",
    },
    {
      key: "combinedRisk",
      header: "Combined risk",
      align: "right",
      sortValue: (row) => row.combinedRisk ?? -1,
      cell: (row) =>
        row.combinedRisk == null ? (
          <span className="text-xs text-muted-foreground">No signal</span>
        ) : (
          <RiskBadge score={row.combinedRisk} severity={(row.severity as "low" | "medium" | "high" | "critical") ?? undefined} />
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workforce health"
        description="Headcount movement, attrition, capacity and department health across the organisation."
        breadcrumbs={[{ label: "Executive Overview", to: "/executive" }, { label: "Workforce Health" }]}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={
          <div className="space-y-5">
            <CardSkeleton count={4} />
            <ChartSkeleton />
          </div>
        }
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Headcount" value={metrics.headcount} icon={Users} tone="primary" hint={`${metrics.active} active`} />
          <KpiCard label="Attrition" value={formatPercent(metrics.attritionRate)} icon={TrendingDown} tone={metrics.attritionRate != null && metrics.attritionRate > 15 ? "warning" : "success"} hint={`${metrics.exited} exited`} />
          <KpiCard label="In notice period" value={metrics.notice} icon={HeartPulse} tone={metrics.notice > 0 ? "warning" : "success"} hint="Retention window" />
          <KpiCard
            label="Above capacity"
            value={metrics.overCapacity.length}
            icon={Building2}
            tone={metrics.overCapacity.length > 0 ? "critical" : "success"}
            hint="Departments over planned headcount"
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Headcount movement"
            description="Joins and exits by month"
            summary={metrics.movement.map((entry) => `${entry.month}: ${entry.joins} joins, ${entry.exits} exits`).join("; ") + "."}
          >
            <ResponsiveContainer width="100%" height={270}>
              <LineChart data={metrics.movement}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="month" tickFormatter={(value: string) => value.slice(2)} {...axisStyle} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Legend />
                <Line type="monotone" dataKey="joins" stroke={CHART_COLORS.success} strokeWidth={2} name="Joins" dot={false} />
                <Line type="monotone" dataKey="exits" stroke={CHART_COLORS.critical} strokeWidth={2} name="Exits" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Performance distribution"
            description="Latest submitted score bands"
            summary={metrics.distribution.map((entry) => `${entry.label}: ${entry.count}`).join(", ") + "."}
          >
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={metrics.distribution}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="label" {...axisStyle} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {metrics.distribution.map((entry, index) => (
                    <Cell key={entry.label} fill={[CHART_COLORS.critical, CHART_COLORS.warning, CHART_COLORS.workflow, CHART_COLORS.success][index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Work-mode distribution"
            description="Active employees by arrangement"
            summary={metrics.workModes.map((entry) => `${entry.label}: ${entry.count}`).join(", ") + "."}
          >
            <ResponsiveContainer width="100%" height={270}>
              <PieChart>
                <Pie data={metrics.workModes} dataKey="count" nameKey="label" innerRadius={60} outerRadius={98} paddingAngle={3}>
                  {metrics.workModes.map((entry) => (
                    <Cell key={entry.mode} fill={MODE_COLORS[entry.mode]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Department combined risk"
            description="Backend risk engine, formula risk-v1"
            summary={metrics.departmentHealth.map((row) => `${row.name} ${row.combinedRisk?.toFixed(0) ?? "n/a"}`).join(", ") + "."}
          >
            {metrics.departmentHealth.length === 0 ? (
              <EmptyState title="No departments" description="Create a department to measure health." />
            ) : (
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={metrics.departmentHealth.map((row) => ({ name: row.name, score: row.combinedRisk ?? 0 }))} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid {...gridStyle} horizontal={false} vertical />
                  <XAxis type="number" domain={[0, 100]} {...axisStyle} />
                  <YAxis type="category" dataKey="name" width={92} {...axisStyle} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [value.toFixed(1), "Combined risk"]} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                    {metrics.departmentHealth.map((row) => (
                      <Cell
                        key={row.id}
                        fill={
                          (row.combinedRisk ?? 0) >= 60
                            ? CHART_COLORS.critical
                            : (row.combinedRisk ?? 0) >= 35
                              ? CHART_COLORS.warning
                              : CHART_COLORS.success
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        <section className="space-y-3">
          <SectionHeader title="Department health" description="Attendance, performance, capacity and combined risk by department" />
          <DataTable
            columns={columns}
            rows={metrics.departmentHealth}
            getRowId={(row) => row.id}
            initialSort={{ key: "combinedRisk", direction: "desc" }}
            pageSize={10}
            caption="Department health"
            emptyState={<EmptyState title="No department data" description="Department health appears once employees and attendance exist." />}
          />
        </section>

        {metrics.overCapacity.length > 0 ? (
          <section className="rounded-lg border border-warning/25 bg-warning-soft p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Capacity risk
            </h2>
            <p className="mt-2 text-sm text-foreground">
              {metrics.overCapacity.map((row) => `${row.name} (${row.headcount}/${row.capacity})`).join(", ")} exceed planned
              headcount. Consider rebalancing or approving additional capacity.
            </p>
          </section>
        ) : (
          <section className="rounded-lg border border-success/25 bg-success-soft p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-success">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Capacity is within plan
            </h2>
            <p className="mt-2 text-sm text-foreground">
              No department exceeds its planned headcount capacity.
            </p>
          </section>
        )}

        <ChartCard
          title="Attendance and performance context"
          description="Organisation-wide summary"
          summary={`Attendance rate ${formatPercent(metrics.attendanceRate)} and average performance ${formatScore(metrics.averagePerformance)}.`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Attendance rate</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPercent(metrics.attendanceRate)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Across all recorded attendance for active employees</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Average performance</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatScore(metrics.averagePerformance)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Latest submitted review per employee</p>
            </div>
          </div>
        </ChartCard>
      </QueryState>
    </div>
  );
}
