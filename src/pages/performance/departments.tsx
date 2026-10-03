import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
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
import { Building2, ClipboardCheck, Target, TrendingUp, Users } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ToneBadge } from "@/components/shared/badges";
import { supabase } from "@/lib/db";
import { useDepartmentOptions } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatScore } from "@/lib/format";
import type { Employee, PerformanceReview, Task } from "@/lib/types";
import { CHART_COLORS, CHART_SERIES, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

interface DepartmentPerformanceRow {
  id: string;
  name: string;
  teamCount: number;
  headcount: number;
  averageScore: number | null;
  previousScore: number | null;
  trend: number | null;
  goalAchievement: number | null;
  taskCompletion: number | null;
  reviewCompletion: number;
  needingReview: number;
}

const BANDS = [
  { label: "0–39", min: 0, max: 39.999 },
  { label: "40–59", min: 40, max: 59.999 },
  { label: "60–79", min: 60, max: 79.999 },
  { label: "80–100", min: 80, max: 100 },
];

export default function PerformanceDepartmentsPage() {
  const { options: departmentOptions } = useDepartmentOptions();
  const { openEmployee360 } = useEmployee360();
  useRealtimeRefresh(["hr_performance_reviews", "hr_employees"], [["performance-departments"]]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["performance-departments"],
    queryFn: async () => {
      const [departments, employees, reviews, tasks, teams] = await Promise.all([
        supabase.from("hr_departments").select("id, name").eq("is_active", true).order("name"),
        supabase.from("hr_employees").select("id, full_name, department_id, status, job_title").neq("status", "exited").limit(1000),
        supabase.from("hr_performance_reviews").select("*").order("period_end", { ascending: false }).limit(5000),
        supabase.from("hr_tasks").select("id, employee_id, status").limit(5000),
        supabase.from("hr_teams").select("id, department_id"),
      ]);
      const firstError = departments.error ?? employees.error ?? reviews.error ?? tasks.error ?? teams.error;
      if (firstError) throw new Error(firstError.message);
      return {
        departments: departments.data ?? [],
        employees: (employees.data ?? []) as Employee[],
        reviews: (reviews.data ?? []) as PerformanceReview[],
        tasks: (tasks.data ?? []) as Task[],
        teams: teams.data ?? [],
      };
    },
  });

  const rows = useMemo<DepartmentPerformanceRow[]>(() => {
    const departments = data?.departments ?? [];
    const employees = data?.employees ?? [];
    const reviews = data?.reviews ?? [];
    const tasks = data?.tasks ?? [];
    const teams = data?.teams ?? [];

    return departments.map((department) => {
      const members = employees.filter((employee) => employee.department_id === department.id);
      const memberIds = new Set(members.map((member) => member.id));
      const departmentReviews = reviews.filter((review) => memberIds.has(review.employee_id));
      const teamCount = teams.filter((team) => team.department_id === department.id).length;

      const scoreOf = (review: PerformanceReview) =>
        review.performance_score == null ? null : Number(review.performance_score);

      const submitted = departmentReviews.filter((review) => review.status !== "draft" && scoreOf(review) != null);
      const latestByEmployee = new Map<string, PerformanceReview>();
      const previousByEmployee = new Map<string, PerformanceReview>();
      submitted.forEach((review) => {
        if (!latestByEmployee.has(review.employee_id)) latestByEmployee.set(review.employee_id, review);
        else if (!previousByEmployee.has(review.employee_id)) previousByEmployee.set(review.employee_id, review);
      });

      const currentScores = Array.from(latestByEmployee.values()).map(scoreOf).filter((v): v is number => v != null);
      const previousScores = Array.from(previousByEmployee.values()).map(scoreOf).filter((v): v is number => v != null);

      const averageScore = currentScores.length
        ? currentScores.reduce((total, value) => total + value, 0) / currentScores.length
        : null;
      const previousScore = previousScores.length
        ? previousScores.reduce((total, value) => total + value, 0) / previousScores.length
        : null;

      const goalScores = Array.from(latestByEmployee.values())
        .map((review) => (review.goal_score == null ? null : Number(review.goal_score)))
        .filter((v): v is number => v != null);
      const goalAchievement = goalScores.length
        ? goalScores.reduce((total, value) => total + value, 0) / goalScores.length
        : null;

      const memberTasks = tasks.filter((task) => task.employee_id && memberIds.has(task.employee_id));
      const taskCompletion = memberTasks.length
        ? (memberTasks.filter((task) => task.status === "completed").length / memberTasks.length) * 100
        : null;

      const reviewedEmployees = new Set(Array.from(latestByEmployee.keys()));
      const needingReview = members.filter((member) => !reviewedEmployees.has(member.id)).length;

      return {
        id: department.id,
        name: department.name,
        teamCount,
        headcount: members.length,
        averageScore,
        previousScore,
        trend: averageScore != null && previousScore != null ? averageScore - previousScore : null,
        goalAchievement,
        taskCompletion,
        reviewCompletion: members.length ? ((members.length - needingReview) / members.length) * 100 : 0,
        needingReview,
      };
    });
  }, [data]);

  const needingReviewEmployees = useMemo(() => {
    const employees = data?.employees ?? [];
    const reviews = data?.reviews ?? [];
    const reviewed = new Set(reviews.filter((review) => review.status !== "draft").map((review) => review.employee_id));
    return employees.filter((employee) => !reviewed.has(employee.id));
  }, [data]);

  const overall = useMemo(() => {
    const scored = rows.filter((row) => row.averageScore != null);
    return {
      average: scored.length ? scored.reduce((total, row) => total + (row.averageScore ?? 0), 0) / scored.length : null,
      reviewCompletion: rows.length ? rows.reduce((total, row) => total + row.reviewCompletion, 0) / rows.length : 0,
      needingReview: needingReviewEmployees.length,
      departments: rows.length,
    };
  }, [needingReviewEmployees.length, rows]);

  const distribution = useMemo(() => {
    const reviews = data?.reviews ?? [];
    const employees = data?.employees ?? [];
    const memberIds = new Set(employees.map((employee) => employee.id));
    const latestByEmployee = new Map<string, PerformanceReview>();
    reviews
      .filter((review) => review.status !== "draft" && review.performance_score != null && memberIds.has(review.employee_id))
      .forEach((review) => {
        if (!latestByEmployee.has(review.employee_id)) latestByEmployee.set(review.employee_id, review);
      });
    const scores = Array.from(latestByEmployee.values()).map((review) => Number(review.performance_score));
    return BANDS.map((band) => ({
      label: band.label,
      count: scores.filter((score) => score >= band.min && score <= band.max).length,
    }));
  }, [data]);

  const trendSeries = useMemo(() => {
    const reviews = data?.reviews ?? [];
    const byPeriod = new Map<string, { total: number; count: number }>();
    reviews
      .filter((review) => review.status !== "draft" && review.performance_score != null)
      .forEach((review) => {
        const key = String(review.period_end).slice(0, 7);
        if (!byPeriod.has(key)) byPeriod.set(key, { total: 0, count: 0 });
        const entry = byPeriod.get(key)!;
        entry.total += Number(review.performance_score);
        entry.count += 1;
      });
    return Array.from(byPeriod.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, entry]) => ({ period, score: Math.round((entry.total / entry.count) * 10) / 10 }));
  }, [data]);

  const columns: Column<DepartmentPerformanceRow>[] = [
    {
      key: "name",
      header: "Department",
      sortValue: (row) => row.name,
      cell: (row) => (
        <Link to={`/workforce/departments/${row.id}`} className="font-medium hover:text-primary">
          {row.name}
        </Link>
      ),
    },
    {
      key: "teamCount",
      header: "Teams",
      align: "right",
      sortValue: (row) => row.teamCount,
      cell: (row) => (
        <Link to={`/workforce/departments/${row.id}`} className="tabular-nums text-muted-foreground hover:text-primary">
          {row.teamCount}
        </Link>
      ),
    },
    { key: "headcount", header: "Headcount", align: "right", sortValue: (row) => row.headcount, cell: (row) => <span className="tabular-nums">{row.headcount}</span> },
    {
      key: "averageScore",
      header: "Score",
      align: "right",
      sortValue: (row) => row.averageScore ?? -1,
      cell: (row) => (
        <span className="tabular-nums font-medium">{formatScore(row.averageScore)}</span>
      ),
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
          <ToneBadge tone={row.trend >= 0 ? "success" : "critical"}>
            {row.trend >= 0 ? "+" : ""}
            {row.trend.toFixed(1)}
          </ToneBadge>
        ),
      hideBelow: "sm",
    },
    {
      key: "goalAchievement",
      header: "Goal achievement",
      align: "right",
      sortValue: (row) => row.goalAchievement ?? -1,
      cell: (row) => <span className="tabular-nums">{formatScore(row.goalAchievement)}</span>,
      hideBelow: "lg",
    },
    {
      key: "taskCompletion",
      header: "Task completion",
      align: "right",
      sortValue: (row) => row.taskCompletion ?? -1,
      cell: (row) => (
        <span className="tabular-nums">{row.taskCompletion != null ? `${row.taskCompletion.toFixed(0)}%` : "—"}</span>
      ),
      hideBelow: "lg",
    },
    {
      key: "reviewCompletion",
      header: "Review completion",
      align: "right",
      sortValue: (row) => row.reviewCompletion,
      cell: (row) => (
        <ToneBadge tone={row.reviewCompletion >= 90 ? "success" : row.reviewCompletion >= 60 ? "warning" : "critical"}>
          {row.reviewCompletion.toFixed(0)}%
        </ToneBadge>
      ),
    },
    {
      key: "needingReview",
      header: "Awaiting review",
      align: "right",
      sortValue: (row) => row.needingReview,
      cell: (row) => <span className="tabular-nums">{row.needingReview}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Department performance"
        description="Department scores, goal achievement, review completion and performance distribution."
        breadcrumbs={[{ label: "Performance", to: "/performance/departments" }, { label: "Departments" }]}
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
          <KpiCard label="Average score" value={formatScore(overall.average)} icon={TrendingUp} tone="insight" hint="Across departments" />
          <KpiCard
            label="Review completion"
            value={`${overall.reviewCompletion.toFixed(0)}%`}
            icon={ClipboardCheck}
            tone={overall.reviewCompletion >= 90 ? "success" : "warning"}
            hint="Employees with a submitted review"
          />
          <KpiCard
            label="Awaiting review"
            value={overall.needingReview}
            icon={Users}
            tone={overall.needingReview > 0 ? "warning" : "success"}
            hint="No submitted review"
          />
          <KpiCard label="Departments" value={overall.departments} icon={Building2} tone="primary" hint="In the organisation" />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Department score"
            description="Average latest submitted performance score"
            summary={rows
              .filter((row) => row.averageScore != null)
              .map((row) => `${row.name} ${row.averageScore?.toFixed(1)}`)
              .join(", ") + "."}
          >
            {rows.filter((row) => row.averageScore != null).length === 0 ? (
              <EmptyState title="No submitted reviews" description="Submit a performance review to compare departments." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={rows.filter((row) => row.averageScore != null)}
                  layout="vertical"
                  margin={{ left: 8 }}
                >
                  <CartesianGrid {...gridStyle} horizontal={false} vertical />
                  <XAxis type="number" domain={[0, 100]} {...axisStyle} />
                  <YAxis type="category" dataKey="name" width={92} {...axisStyle} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [value.toFixed(1), "Score"]} />
                  <Bar dataKey="averageScore" radius={[0, 4, 4, 0]}>
                    {rows
                      .filter((row) => row.averageScore != null)
                      .map((row) => (
                        <Cell
                          key={row.id}
                          fill={
                            (row.averageScore ?? 0) >= 80
                              ? CHART_COLORS.success
                              : (row.averageScore ?? 0) >= 60
                                ? CHART_COLORS.warning
                                : CHART_COLORS.critical
                          }
                        />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Performance trend"
            description="Average score by review period"
            summary={trendSeries.map((entry) => `${entry.period} ${entry.score}`).join(", ") + "."}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendSeries}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="period" {...axisStyle} />
                <YAxis domain={[0, 100]} {...axisStyle} width={36} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="score" stroke={CHART_COLORS.insight} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Performance distribution"
            description="Employees by latest submitted score band"
            summary={distribution.map((entry) => `${entry.label}: ${entry.count}`).join(", ") + "."}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distribution}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="label" {...axisStyle} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {distribution.map((entry, index) => (
                    <Cell key={entry.label} fill={[CHART_COLORS.critical, CHART_COLORS.warning, CHART_COLORS.workflow, CHART_COLORS.success][index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Goal achievement vs task completion"
            description="Department comparison"
            summary={rows
              .map((row) => `${row.name} goals ${row.goalAchievement?.toFixed(1) ?? "n/a"}, tasks ${row.taskCompletion?.toFixed(0) ?? "n/a"}%`)
              .join("; ") + "."}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="name" {...axisStyle} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} {...axisStyle} width={36} />
                <Tooltip {...tooltipStyle} />
                <Legend />
                <Bar dataKey="goalAchievement" name="Goals" fill={CHART_COLORS.insight} radius={[4, 4, 0, 0]} />
                <Bar dataKey="taskCompletion" name="Tasks %" fill={CHART_COLORS.workflow} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <section className="space-y-3">
          <SectionHeader title="Department detail" description="Sort any column to compare departments" />
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            initialSort={{ key: "averageScore", direction: "desc" }}
            pageSize={10}
            caption="Department performance detail"
            emptyState={<EmptyState title="No departments" description="Create a department to measure performance." />}
          />
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Employees requiring review"
            description="Active employees without a submitted performance review — their performance risk cannot be evidenced"
          />
          {needingReviewEmployees.length === 0 ? (
            <EmptyState
              title="Every employee has a submitted review"
              description="Performance risk can be evidenced for the whole active workforce."
              icon={<Target className="h-5 w-5" aria-hidden="true" />}
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {needingReviewEmployees.slice(0, 40).map((employee) => (
                <li key={employee.id}>
                  <button
                    type="button"
                    onClick={() => openEmployee360(employee.id)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-card transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {employee.full_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </QueryState>
    </div>
  );
}
