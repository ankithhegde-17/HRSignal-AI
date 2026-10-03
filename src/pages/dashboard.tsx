import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  Building2,
  ClipboardList,
  Gauge,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserMinus,
  Users,
} from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState, TableSkeleton } from "@/components/shared/states";
import { RiskBadge, StatusBadge, ToneBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/db";
import { useGlobalFilters } from "@/providers/filter-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { CANDIDATE_STAGE_LABELS, SIGNAL_TYPE_LABELS, type CandidateStage } from "@/lib/types";
import { formatDate, formatPercent, formatScore } from "@/lib/format";
import { CHART_COLORS, CHART_SERIES, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

const STAGE_ORDER: CandidateStage[] = ["applied", "screening", "interview", "internship", "full_time_offer", "hired"];

export default function DashboardPage() {
  const { departmentId, from, to, days } = useGlobalFilters();
  const navigate = useNavigate();

  useRealtimeRefresh(
    ["hr_employees", "hr_departments", "hr_attendance", "hr_candidates", "hr_signals", "hr_actions", "hr_approvals", "hr_attendance_imports"],
    [["dashboard"]],
    "hr-dashboard",
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard", departmentId, from, to],
    queryFn: async () => {
      const employeeQuery = supabase
        .from("hr_employees")
        .select("id, department_id, status, work_mode, employment_type, exit_date, joining_date");
      const [employees, departments, attendance, reviews, candidates, requisitions, signals, actions, approvals, imports] =
        await Promise.all([
          departmentId === "all" ? employeeQuery : employeeQuery.eq("department_id", departmentId),
          supabase.from("hr_departments").select("id, name, capacity, head_employee_id").eq("is_active", true),
          supabase.from("hr_attendance").select("employee_id, status, attendance_date").gte("attendance_date", from).lte("attendance_date", to).limit(20000),
          supabase.from("hr_performance_reviews").select("employee_id, performance_score, period_end, status"),
          supabase.from("hr_candidates").select("id, current_stage, status, requisition_id"),
          supabase.from("hr_job_requisitions").select("id, department_id, status, openings"),
          supabase.from("hr_signals").select("id, entity_type, entity_id, signal_type, score, severity, explanation, detected_at").order("score", { ascending: false }).limit(500),
          supabase.from("hr_actions").select("id, title, status, priority, due_date").order("created_at", { ascending: false }).limit(50),
          supabase.from("hr_approvals").select("id, action_id, decision").eq("decision", "pending"),
          supabase.from("hr_attendance_imports").select("id, file_name, status, valid_rows, invalid_rows, duplicate_rows, total_rows, created_at").order("created_at", { ascending: false }).limit(5),
        ]);

      const firstError = [employees, departments, attendance, reviews, candidates, requisitions, signals, actions, approvals, imports].find((result) => result.error)?.error;
      if (firstError) throw new Error(firstError.message);

      return {
        employees: employees.data ?? [],
        departments: departments.data ?? [],
        attendance: attendance.data ?? [],
        reviews: reviews.data ?? [],
        candidates: candidates.data ?? [],
        requisitions: requisitions.data ?? [],
        signals: signals.data ?? [],
        actions: actions.data ?? [],
        approvals: approvals.data ?? [],
        imports: imports.data ?? [],
      };
    },
  });

  const metrics = useMemo(() => {
    const employees = data?.employees ?? [];
    const activeEmployees = employees.filter((e) => e.status !== "exited");
    const exited = employees.filter((e) => e.status === "exited");
    const employeeIds = new Set(employees.map((e) => e.id));

    const counted = (data?.attendance ?? []).filter(
      (record) => employeeIds.has(record.employee_id) && ["present", "late", "half-day", "absent"].includes(record.status),
    );
    const credited = counted.reduce((total, record) => {
      if (record.status === "present") return total + 1;
      if (record.status === "late" || record.status === "half-day") return total + 0.5;
      return total;
    }, 0);
    const attendanceRate = counted.length > 0 ? (credited / counted.length) * 100 : null;

    const deptReviews = (data?.reviews ?? []).filter((review) => employeeIds.has(review.employee_id) && review.performance_score != null);
    const avgPerformance = deptReviews.length
      ? deptReviews.reduce((total, review) => total + Number(review.performance_score), 0) / deptReviews.length
      : null;

    const openRequisitions = (data?.requisitions ?? []).filter(
      (requisition) => requisition.status === "open" && (departmentId === "all" || requisition.department_id === departmentId),
    );
    const openPositions = openRequisitions.reduce((total, requisition) => total + Number(requisition.openings ?? 0), 0);

    const activeCandidates = (data?.candidates ?? []).filter((candidate) => candidate.status === "active");

    const employeeSignals = (data?.signals ?? []).filter((signal) => signal.entity_type === "employee");
    const departmentSignals = (data?.signals ?? []).filter((signal) => signal.entity_type === "department");
    const highRisk = employeeSignals.filter(
      (signal) => signal.signal_type === "combined_risk" && Number(signal.score) >= 60 && employeeIds.has(signal.entity_id),
    );

    const departmentsNeedingAttention = departmentSignals.filter(
      (signal) => signal.signal_type === "combined_risk" && Number(signal.score) >= 35,
    );

    const pendingActions = (data?.actions ?? []).filter(
      (action) => !["resolved", "failed", "dismissed"].includes(action.status),
    );

    // Attendance trend by day
    const byDate = new Map<string, { credited: number; total: number }>();
    counted.forEach((record) => {
      if (!byDate.has(record.attendance_date)) byDate.set(record.attendance_date, { credited: 0, total: 0 });
      const entry = byDate.get(record.attendance_date)!;
      entry.total += 1;
      if (record.status === "present") entry.credited += 1;
      else if (record.status === "late" || record.status === "half-day") entry.credited += 0.5;
    });
    const attendanceTrend = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({ date, rate: entry.total ? Math.round((entry.credited / entry.total) * 1000) / 10 : 0 }));

    // Performance trend by period
    const byPeriod = new Map<string, { total: number; count: number }>();
    deptReviews.forEach((review) => {
      const key = String(review.period_end).slice(0, 7);
      if (!byPeriod.has(key)) byPeriod.set(key, { total: 0, count: 0 });
      const entry = byPeriod.get(key)!;
      entry.total += Number(review.performance_score);
      entry.count += 1;
    });
    const performanceTrend = Array.from(byPeriod.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, entry]) => ({ period, score: Math.round((entry.total / entry.count) * 10) / 10 }));

    const funnel = STAGE_ORDER.map((stage) => ({
      stage: CANDIDATE_STAGE_LABELS[stage],
      count: activeCandidates.filter((candidate) => candidate.current_stage === stage).length,
    }));

    const composition = (data?.departments ?? [])
      .map((department) => ({
        name: department.name,
        count: activeEmployees.filter((employee) => employee.department_id === department.id).length,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);

    const departmentHealth = (data?.departments ?? [])
      .map((department) => {
        const signal = departmentSignals.find(
          (item) => item.entity_id === department.id && item.signal_type === "combined_risk",
        );
        return {
          name: department.name,
          score: signal ? Number(signal.score) : 0,
          severity: signal?.severity ?? "low",
        };
      })
      .sort((a, b) => b.score - a.score);

    const priorityRisks = employeeSignals
      .filter((signal) => Number(signal.score) >= 60)
      .slice(0, 6);

    return {
      totalEmployees: employees.length,
      activeEmployees: activeEmployees.length,
      exited: exited.length,
      departments: data?.departments.length ?? 0,
      attendanceRate,
      avgPerformance,
      openPositions,
      activeCandidates: activeCandidates.length,
      highRisk,
      departmentsNeedingAttention,
      pendingActions,
      pendingApprovals: data?.approvals.length ?? 0,
      attendanceTrend,
      performanceTrend,
      funnel,
      composition,
      departmentHealth,
      priorityRisks,
      imports: data?.imports ?? [],
      employeeNameById: new Map(employees.map((employee) => [employee.id, employee])),
    };
  }, [data, departmentId]);

  const rangeLabel = days > 0 ? `Last ${days} days` : `${formatDate(from)} – ${formatDate(to)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workforce overview"
        description={`Live workforce position across attendance, performance, recruitment and risk. Window: ${rangeLabel}.`}
        breadcrumbs={[{ label: "Overview" }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/attendance?import=1">
                <ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />
                Upload attendance
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/insights/ask">
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                Ask HR Signal
              </Link>
            </Button>
          </>
        }
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={
          <div className="space-y-6">
            <CardSkeleton count={4} />
            <CardSkeleton count={4} />
          </div>
        }
      >
        <section aria-label="Key workforce metrics" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total employees"
            value={metrics.totalEmployees}
            icon={Users}
            tone="primary"
            hint={`${metrics.activeEmployees} active · ${metrics.exited} exited`}
            onClick={() => navigate("/workforce/employees")}
          />
          <KpiCard
            label="Departments"
            value={metrics.departments}
            icon={Building2}
            tone="workflow"
            hint={`${metrics.departmentsNeedingAttention.length} need attention`}
            onClick={() => navigate("/workforce/departments")}
          />
          <KpiCard
            label="Attendance rate"
            value={formatPercent(metrics.attendanceRate)}
            icon={BadgeCheck}
            tone={metrics.attendanceRate != null && metrics.attendanceRate < 85 ? "warning" : "success"}
            hint={rangeLabel}
            onClick={() => navigate("/attendance")}
          />
          <KpiCard
            label="Average performance"
            value={formatScore(metrics.avgPerformance)}
            icon={TrendingUp}
            tone="insight"
            hint="Latest submitted reviews"
            onClick={() => navigate("/performance/employees")}
          />
          <KpiCard
            label="Open positions"
            value={metrics.openPositions}
            icon={Briefcase}
            tone="workflow"
            hint={`${metrics.activeCandidates} active candidates`}
            onClick={() => navigate("/recruitment")}
          />
          <KpiCard
            label="High-risk employees"
            value={metrics.highRisk.length}
            icon={ShieldAlert}
            tone={metrics.highRisk.length > 0 ? "critical" : "success"}
            hint="Combined risk 60 or above"
            onClick={() => navigate("/insights/risks?severity=high")}
          />
          <KpiCard
            label="Pending actions"
            value={metrics.pendingActions.length}
            icon={Gauge}
            tone="workflow"
            hint={`${metrics.pendingApprovals} awaiting approval`}
            onClick={() => navigate("/actions")}
          />
          <KpiCard
            label="Exited employees"
            value={metrics.exited}
            icon={UserMinus}
            tone="neutral"
            hint="All time"
            onClick={() => navigate("/workforce/status")}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-12">
          <ChartCard
            title="Attendance trend"
            className="xl:col-span-7"
            description={`Daily attendance rate · ${rangeLabel}`}
            summary={`Attendance rate per working day over the selected window. The latest value is ${
              metrics.attendanceTrend.at(-1)?.rate ?? 0
            } percent.`}
          >
            {metrics.attendanceTrend.length === 0 ? (
              <EmptyState title="No attendance in this window" description="Upload a biometric export to populate the trend." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={metrics.attendanceTrend}>
                  <defs>
                    <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} {...axisStyle} />
                  <YAxis domain={[0, 100]} unit="%" {...axisStyle} width={40} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [`${value}%`, "Attendance"]} />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    fill="url(#attendanceFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Performance trend"
            description="Average performance score by review period"
            summary={`Average performance score across ${metrics.performanceTrend.length} review periods.`}
            className="xl:col-span-5"
          >
            {metrics.performanceTrend.length === 0 ? (
              <EmptyState title="No submitted reviews" description="Submit a performance review to populate the trend." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={metrics.performanceTrend}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="period" {...axisStyle} />
                  <YAxis domain={[0, 100]} {...axisStyle} width={40} />
                  <Tooltip {...tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={CHART_COLORS.insight}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Recruitment funnel"
            description="Active candidates by stage"
            summary={`Active candidates by stage: ${metrics.funnel.map((entry) => `${entry.stage} ${entry.count}`).join(", ")}.`}
            className="xl:col-span-5"
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={metrics.funnel}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="stage" {...axisStyle} interval={0} angle={-12} textAnchor="end" height={54} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {metrics.funnel.map((entry, index) => (
                    <Cell key={entry.stage} fill={CHART_SERIES[index % CHART_SERIES.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Department health"
            description="Combined risk score by department (attendance 40% · performance 40% · task trend 20%)"
            summary={`Combined department risk: ${metrics.departmentHealth
              .map((entry) => `${entry.name} ${entry.score.toFixed(0)}`)
              .join(", ")}.`}
            className="xl:col-span-7"
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={metrics.departmentHealth} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid {...gridStyle} horizontal={false} vertical />
                <XAxis type="number" domain={[0, 100]} {...axisStyle} />
                <YAxis type="category" dataKey="name" width={92} {...axisStyle} />
                <Tooltip {...tooltipStyle} formatter={(value: number) => [value.toFixed(1), "Combined risk"]} />
                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                  {metrics.departmentHealth.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={
                        entry.score >= 60
                          ? CHART_COLORS.critical
                          : entry.score >= 35
                            ? CHART_COLORS.warning
                            : CHART_COLORS.success
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid gap-5 xl:grid-cols-12">
          <ChartCard
            title="Workforce composition"
            description="Active employees by department"
            summary={`Headcount by department: ${metrics.composition
              .map((entry) => `${entry.name} ${entry.count}`)
              .join(", ")}.`}
            className="xl:col-span-4"
          >
            {metrics.composition.length === 0 ? (
              <EmptyState title="No employees yet" description="Add employees to build the workforce." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={metrics.composition} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid {...gridStyle} horizontal={false} vertical />
                  <XAxis type="number" allowDecimals={false} {...axisStyle} />
                  <YAxis type="category" dataKey="name" width={92} {...axisStyle} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill={CHART_COLORS.workflow} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <section className="rounded-card border border-border bg-card shadow-card xl:col-span-8">
            <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Priority risks</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Highest scoring employee signals, verified by the risk engine</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/insights/risks">View all</Link>
              </Button>
            </div>
            {metrics.priorityRisks.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No elevated risks"
                  description="No employee currently scores 60 or above on combined risk."
                  icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {metrics.priorityRisks.map((signal) => {
                  const employee = metrics.employeeNameById.get(signal.entity_id);
                  return (
                    <li key={signal.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {employee?.full_name ?? "Unknown employee"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {SIGNAL_TYPE_LABELS[signal.signal_type as keyof typeof SIGNAL_TYPE_LABELS]} · detected{" "}
                          {formatDate(signal.detected_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiskBadge score={signal.score} severity={signal.severity} />
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/insights/risks?employee=${signal.entity_id}`}>Evidence</Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card shadow-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Pending actions</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Open work across the action center</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/actions">Open queue</Link>
              </Button>
            </div>
            {metrics.pendingActions.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Nothing pending" description="All actions are resolved or dismissed." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {metrics.pendingActions.slice(0, 6).map((action) => (
                  <li key={action.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{action.title}</p>
                      <p className="text-xs text-muted-foreground">Due {formatDate(action.due_date)}</p>
                    </div>
                    <ToneBadge tone={action.priority === "critical" ? "critical" : action.priority === "high" ? "warning" : "info"}>
                      {action.status.replace(/_/g, " ")}
                    </ToneBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card shadow-card">
            <SectionHeader
              className="border-b border-border px-5 py-4 pb-4"
              title="Recent attendance imports"
              description="Import history with validation outcomes"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/attendance">Import center</Link>
                </Button>
              }
            />
            {metrics.imports.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No imports yet" description="Upload a biometric export to start." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {metrics.imports.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{record.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {record.valid_rows}/{record.total_rows} valid · {record.invalid_rows} invalid ·{" "}
                        {record.duplicate_rows} duplicate · {formatDate(record.created_at)}
                      </p>
                    </div>
                    <ToneBadge
                      tone={
                        record.status === "confirmed" ? "success" : record.status === "failed" ? "critical" : "workflow"
                      }
                    >
                      {record.status.replace(/_/g, " ")}
                    </ToneBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card shadow-card">
          <SectionHeader
            className="border-b border-border px-5 py-4 pb-4"
            title="Departments requiring attention"
            description="Departments whose combined risk has reached the medium band or above"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/workforce/departments">All departments</Link>
              </Button>
            }
          />
          {metrics.departmentsNeedingAttention.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="All departments are healthy"
                description="No department currently scores 35 or above on combined risk."
                icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {metrics.departmentsNeedingAttention.map((signal) => {
                const department = (data?.departments ?? []).find((item) => item.id === signal.entity_id);
                return (
                  <li key={signal.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{department?.name ?? "Department"}</p>
                      <p className="truncate text-xs text-muted-foreground">{signal.explanation}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <RiskBadge score={signal.score} severity={signal.severity} />
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/insights/risks?department=${signal.entity_id}`}>Evidence</Link>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </QueryState>
    </div>
  );
}
