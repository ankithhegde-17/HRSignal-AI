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
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Building2,
  ClipboardCheck,
  Gauge,
  HeartPulse,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, ToneBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/db";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate, formatPercent, formatScore } from "@/lib/format";
import { SIGNAL_TYPE_LABELS } from "@/lib/types";
import { CHART_COLORS, CHART_SERIES, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

export default function ExecutiveOverviewPage() {
  const navigate = useNavigate();

  useRealtimeRefresh(
    ["hr_employees", "hr_attendance", "hr_performance_reviews", "hr_signals", "hr_actions", "hr_approvals", "hr_candidates"],
    [["executive-overview"]],
    "hr-executive",
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["executive-overview"],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const [employees, departments, attendance, reviews, signals, actions, approvals, insights, candidates, requisitions] =
        await Promise.all([
          supabase.from("hr_employees").select("id, department_id, status, work_mode, exit_date, joining_date").limit(2000),
          supabase.from("hr_departments").select("id, name, capacity").eq("is_active", true).order("name"),
          supabase.from("hr_attendance").select("employee_id, status, attendance_date").gte("attendance_date", cutoff.toISOString().slice(0, 10)).limit(20000),
          supabase.from("hr_performance_reviews").select("employee_id, performance_score, period_end, status").limit(5000),
          supabase.from("hr_signals").select("*").order("score", { ascending: false }).limit(1000),
          supabase.from("hr_actions").select("id, title, status, priority, due_date").limit(500),
          supabase.from("hr_approvals").select("id, action_id, decision, requested_at").eq("decision", "pending"),
          supabase.from("hr_ai_insights").select("*").order("generated_at", { ascending: false }).limit(20),
          supabase.from("hr_candidates").select("id, current_stage, status").limit(1000),
          supabase.from("hr_job_requisitions").select("id, status, openings, department_id").limit(200),
        ]);
      const firstError = [employees, departments, attendance, reviews, signals, actions, approvals, insights, candidates, requisitions].find(
        (result) => result.error,
      )?.error;
      if (firstError) throw new Error(firstError.message);
      return {
        employees: employees.data ?? [],
        departments: departments.data ?? [],
        attendance: attendance.data ?? [],
        reviews: reviews.data ?? [],
        signals: signals.data ?? [],
        actions: actions.data ?? [],
        approvals: approvals.data ?? [],
        insights: insights.data ?? [],
        candidates: candidates.data ?? [],
        requisitions: requisitions.data ?? [],
      };
    },
  });

  const metrics = useMemo(() => {
    const employees = data?.employees ?? [];
    const active = employees.filter((employee) => employee.status !== "exited");
    const exited = employees.filter((employee) => employee.status === "exited");

    const counted = (data?.attendance ?? []).filter((record) => ["present", "late", "half-day", "absent"].includes(record.status));
    const credited = counted.reduce((total, record) => {
      if (record.status === "present") return total + 1;
      if (record.status === "late" || record.status === "half-day") return total + 0.5;
      return total;
    }, 0);
    const attendanceRate = counted.length ? (credited / counted.length) * 100 : null;

    const submitted = (data?.reviews ?? []).filter((review) => review.status !== "draft" && review.performance_score != null);
    const latestByEmployee = new Map<string, number>();
    submitted.forEach((review) => {
      if (!latestByEmployee.has(review.employee_id)) latestByEmployee.set(review.employee_id, Number(review.performance_score));
    });
    const scores = Array.from(latestByEmployee.values());
    const averagePerformance = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null;

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

    const byPeriod = new Map<string, { total: number; count: number }>();
    submitted.forEach((review) => {
      const key = String(review.period_end).slice(0, 7);
      if (!byPeriod.has(key)) byPeriod.set(key, { total: 0, count: 0 });
      const entry = byPeriod.get(key)!;
      entry.total += Number(review.performance_score);
      entry.count += 1;
    });
    const performanceTrend = Array.from(byPeriod.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, entry]) => ({ period, score: Math.round((entry.total / entry.count) * 10) / 10 }));

    const departmentHealth = (data?.departments ?? []).map((department) => {
      const signal = (data?.signals ?? []).find(
        (item) => item.entity_type === "department" && item.entity_id === department.id && item.signal_type === "combined_risk",
      );
      return {
        name: department.name,
        score: signal ? Number(signal.score) : 0,
        severity: signal?.severity ?? "low",
      };
    }).sort((a, b) => b.score - a.score);

    const criticalRisks = (data?.signals ?? []).filter(
      (signal) => signal.entity_type === "employee" && Number(signal.score) >= 80,
    );

    const strategicRecommendations = (data?.insights ?? []).filter((insight) => insight.recommendation).slice(0, 4);

    const openRequisitions = (data?.requisitions ?? []).filter((requisition) => requisition.status === "open");
    const activeCandidates = (data?.candidates ?? []).filter((candidate) => candidate.status === "active");

    return {
      headcount: employees.length,
      active: active.length,
      exited: exited.length,
      departments: data?.departments?.length ?? 0,
      attendanceRate,
      averagePerformance,
      attendanceTrend,
      performanceTrend,
      departmentHealth,
      criticalRisks,
      strategicRecommendations,
      pendingApprovals: data?.approvals ?? [],
      activeActions: (data?.actions ?? []).filter((action) => !["resolved", "failed", "dismissed"].includes(action.status)),
      openings: openRequisitions.reduce((total, requisition) => total + Number(requisition.openings ?? 0), 0),
      openRequisitions: openRequisitions.length,
      activeCandidates: activeCandidates.length,
      hired: (data?.candidates ?? []).filter((candidate) => candidate.current_stage === "hired").length,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive overview"
        description="Workforce position, department health, strategic risk and the decisions waiting on you."
        breadcrumbs={[{ label: "Executive Overview" }]}
        actions={
          <Button size="sm" onClick={() => navigate("/executive/approvals")}>
            <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            {metrics.pendingApprovals.length} pending approval{metrics.pendingApprovals.length === 1 ? "" : "s"}
          </Button>
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
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Headcount" value={metrics.headcount} icon={Users} tone="primary" hint={`Across ${metrics.departments} departments`} onClick={() => navigate("/executive/workforce-health")} />
          <KpiCard label="Active employees" value={metrics.active} icon={HeartPulse} tone="success" hint={`${metrics.exited} exited`} />
          <KpiCard label="Attendance rate" value={formatPercent(metrics.attendanceRate)} icon={ClipboardCheck} tone={metrics.attendanceRate != null && metrics.attendanceRate < 85 ? "warning" : "success"} hint="Last 90 days" onClick={() => navigate("/executive/workforce-health")} />
          <KpiCard label="Average performance" value={formatScore(metrics.averagePerformance)} icon={TrendingUp} tone="insight" hint="Latest submitted reviews" onClick={() => navigate("/executive/insights")} />
          <KpiCard label="Critical risks" value={metrics.criticalRisks.length} icon={ShieldAlert} tone={metrics.criticalRisks.length ? "critical" : "success"} hint="Score 80 or above" onClick={() => navigate("/executive/insights")} />
          <KpiCard label="Pending approvals" value={metrics.pendingApprovals.length} icon={UserCheck} tone={metrics.pendingApprovals.length ? "warning" : "success"} hint="Awaiting your decision" onClick={() => navigate("/executive/approvals")} />
          <KpiCard label="Active actions" value={metrics.activeActions.length} icon={Gauge} tone="workflow" hint="Open across HR" onClick={() => navigate("/executive/hr-team")} />
          <KpiCard label="Recruitment" value={metrics.openings} icon={Building2} tone="info" hint={`${metrics.openRequisitions} open requisitions · ${metrics.activeCandidates} candidates`} onClick={() => navigate("/executive/workforce-health")} />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Attendance trend"
            description="Daily attendance rate across the last 90 days"
            summary={`Attendance rate over the last 90 days. Latest value ${metrics.attendanceTrend.at(-1)?.rate ?? 0} percent.`}
          >
            {metrics.attendanceTrend.length === 0 ? (
              <EmptyState title="No attendance data" description="Attendance appears once HR imports a biometric export." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={metrics.attendanceTrend}>
                  <defs>
                    <linearGradient id="execAttendance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} {...axisStyle} />
                  <YAxis domain={[0, 100]} unit="%" {...axisStyle} width={40} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [`${value}%`, "Attendance"]} />
                  <Area type="monotone" dataKey="rate" stroke={CHART_COLORS.primary} strokeWidth={2} fill="url(#execAttendance)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Performance trend"
            description="Average performance score by review period"
            summary={metrics.performanceTrend.map((entry) => `${entry.period}: ${entry.score}`).join(", ") + "."}
          >
            {metrics.performanceTrend.length === 0 ? (
              <EmptyState title="No performance data" description="Submit a performance review to build the trend." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={metrics.performanceTrend}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="period" {...axisStyle} />
                  <YAxis domain={[0, 100]} {...axisStyle} width={40} />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="score" stroke={CHART_COLORS.insight} strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Department health"
            description="Combined risk by department"
            summary={metrics.departmentHealth.map((entry) => `${entry.name} ${entry.score.toFixed(0)}`).join(", ") + "."}
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
                      fill={entry.score >= 60 ? CHART_COLORS.critical : entry.score >= 35 ? CHART_COLORS.warning : CHART_COLORS.success}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Recruitment funnel"
            description="Active candidates by stage"
            summary={`Active candidates by stage. ${metrics.activeCandidates} candidates in total.`}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={["applied", "screening", "interview", "internship", "full_time_offer", "hired"].map((stage) => ({
                  stage: stage.replace(/_/g, " "),
                  count: (data?.candidates ?? []).filter((candidate) => candidate.current_stage === stage && candidate.status === "active").length,
                }))}
              >
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="stage" {...axisStyle} interval={0} angle={-12} textAnchor="end" height={54} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <Cell key={index} fill={CHART_SERIES[index % CHART_SERIES.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card shadow-card">
            <SectionHeader
              className="border-b border-border px-5 py-4 pb-4"
              title="Critical risks"
              description="Employees scoring 80 or above on any verified signal"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/executive/insights">All insights</Link>
                </Button>
              }
            />
            {metrics.criticalRisks.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No critical risks"
                  description="No employee currently scores 80 or above on a verified signal."
                  icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {metrics.criticalRisks.slice(0, 6).map((signal) => (
                  <li key={signal.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{signal.explanation}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <RiskBadge score={signal.score} severity={signal.severity} />
                      <EvidenceQualityBadge quality={signal.evidence_quality} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card shadow-card">
            <SectionHeader
              className="border-b border-border px-5 py-4 pb-4"
              title="Strategic recommendations"
              description="Evidence-backed next steps from the insights engine"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/executive/insights">View all</Link>
                </Button>
              }
            />
            {metrics.strategicRecommendations.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No recommendations" description="Recommendations are generated from verified signals." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {metrics.strategicRecommendations.map((insight) => (
                  <li key={insight.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-foreground">{insight.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{insight.recommendation}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <EvidenceQualityBadge quality={insight.confidence} />
                      <span className="text-xs text-muted-foreground">Generated {formatDate(insight.generated_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card shadow-card">
          <SectionHeader
            className="border-b border-border px-5 py-4 pb-4"
            title="Active actions"
            description="Work in flight across the HR team"
          />
          {metrics.activeActions.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No active actions" description="All actions are resolved, failed or dismissed." />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {metrics.activeActions.slice(0, 6).map((action) => (
                <li key={action.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{action.title}</p>
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

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
          {metrics.exited} employees have exited and are retained in history for accurate attrition reporting.
        </p>
      </QueryState>
    </div>
  );
}
