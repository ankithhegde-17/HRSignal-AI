import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, GraduationCap, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useTeamOptions } from "@/hooks/use-lookups";
import { useGlobalFilters } from "@/providers/filter-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { EMPLOYMENT_TYPE_LABELS, type Employee, type EmploymentType } from "@/lib/types";
import { CHART_COLORS, CHART_SERIES, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

function monthKey(value: string) {
  return value.slice(0, 7);
}

export default function WorkforceAnalyticsPage() {
  const { options: departmentOptions } = useDepartmentOptions();
  const { teams } = useTeamOptions();
  const { teamId, departmentId } = useGlobalFilters();
  useRealtimeRefresh(["hr_employees"], [["workforce-analytics"]]);

  const { data: employees = [], isLoading, isError, refetch } = useQuery<Employee[]>({
    queryKey: ["workforce-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  const metrics = useMemo(() => {
    const active = employees.filter((employee) => employee.status !== "exited");
    const exited = employees.filter((employee) => employee.status === "exited");
    const scoped = teamId === "all" ? employees : employees.filter((employee) => employee.team_id === teamId);
    const scopedActive = teamId === "all" ? active : active.filter((employee) => employee.team_id === teamId);

    const byType = (Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[])
      .map((type) => ({ type, label: EMPLOYMENT_TYPE_LABELS[type], count: scoped.filter((e) => e.employment_type === type).length }))
      .filter((entry) => entry.count > 0);

    const byDepartment = departmentOptions
      .map((option) => ({
        name: option.label,
        count: scoped.filter((employee) => employee.department_id === option.value).length,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);

    const byTeam = teams
      .map((team) => ({
        name: team.name,
        count: scoped.filter((employee) => employee.team_id === team.id).length,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);

    // Joins and exits by month over the last 18 months
    const months: string[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 17; i >= 0; i -= 1) {
      const d = new Date(cursor);
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const joins = new Map<string, number>(months.map((month) => [month, 0]));
    const exits = new Map<string, number>(months.map((month) => [month, 0]));
    employees.forEach((employee) => {
      if (employee.joining_date) {
        const key = monthKey(employee.joining_date);
        if (joins.has(key)) joins.set(key, (joins.get(key) ?? 0) + 1);
      }
      if (employee.exit_date) {
        const key = monthKey(employee.exit_date);
        if (exits.has(key)) exits.set(key, (exits.get(key) ?? 0) + 1);
      }
    });
    const movement = months.map((month) => ({
      month,
      joins: joins.get(month) ?? 0,
      exits: exits.get(month) ?? 0,
    }));
    const movementWithHeadcount = movement.reduce<Array<{ month: string; joins: number; exits: number; net: number; headcount: number }>>(
      (accumulator, entry) => {
        const previous = accumulator.at(-1)?.headcount ?? active.length - movement.reduce((total, item) => total + item.joins - item.exits, 0);
        accumulator.push({ ...entry, net: entry.joins - entry.exits, headcount: previous + entry.joins - entry.exits });
        return accumulator;
      },
      [],
    );

    // Tenure buckets
    const now = new Date();
    const buckets = [
      { label: "< 6 months", min: 0, max: 0.5 },
      { label: "6–12 months", min: 0.5, max: 1 },
      { label: "1–2 years", min: 1, max: 2 },
      { label: "2–4 years", min: 2, max: 4 },
      { label: "4+ years", min: 4, max: 100 },
    ];
    const tenure = buckets.map((bucket) => {
      const count = scopedActive.filter((employee) => {
        if (!employee.joining_date) return false;
        const years = (now.getTime() - new Date(employee.joining_date).getTime()) / (365.25 * 86400000);
        return years >= bucket.min && years < bucket.max;
      }).length;
      return { label: bucket.label, count };
    });

    const avgTenureYears =
      scopedActive.length > 0
        ? scopedActive.reduce((total, employee) => {
            if (!employee.joining_date) return total;
            return total + (now.getTime() - new Date(employee.joining_date).getTime()) / (365.25 * 86400000);
          }, 0) / scopedActive.length
        : null;

    const internCount = scoped.filter((employee) => employee.employment_type === "intern").length;

    return {
      total: scoped.length,
      active: scopedActive.length,
      exited: scoped.filter((employee) => employee.status === "exited").length,
      byType,
      byDepartment,
      byTeam,
      movement: movementWithHeadcount,
      tenure,
      avgTenureYears,
      internCount,
      locations: Array.from(new Set(scoped.map((e) => e.location).filter(Boolean))).length,
    };
  }, [departmentOptions, employees, teamId, teams]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workforce analytics"
        description="Composition, movement and tenure across the entire workforce."
        breadcrumbs={[{ label: "Workforce", to: "/workforce/employees" }, { label: "More Analytics" }]}
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
          <KpiCard label="Employee records" value={metrics.total} icon={Users} tone="primary" hint={`${metrics.active} active`} />
          <KpiCard
            label="Average tenure"
            value={metrics.avgTenureYears != null ? `${metrics.avgTenureYears.toFixed(1)} yrs` : "—"}
            icon={CalendarClock}
            tone="workflow"
            hint="Active employees"
          />
          <KpiCard label="Interns" value={metrics.internCount} icon={GraduationCap} tone="insight" hint="Internship pipeline" />
          <KpiCard label="Locations" value={metrics.locations} icon={TrendingUp} tone="success" hint="Distinct work locations" />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Headcount movement"
            description="Joins, exits and net headcount by month"
            summary={`Headcount moved from ${metrics.movement[0]?.headcount ?? 0} to ${
              metrics.movement.at(-1)?.headcount ?? 0
            } over the last 18 months.`}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={metrics.movement}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="month" tickFormatter={(value: string) => value.slice(2)} {...axisStyle} />
                <YAxis allowDecimals={false} {...axisStyle} width={36} />
                <Tooltip {...tooltipStyle} />
                <Legend />
                <Line type="monotone" dataKey="headcount" stroke={CHART_COLORS.primary} strokeWidth={2.5} name="Headcount" dot={false} />
                <Line type="monotone" dataKey="joins" stroke={CHART_COLORS.success} strokeWidth={1.5} name="Joins" dot={false} />
                <Line type="monotone" dataKey="exits" stroke={CHART_COLORS.critical} strokeWidth={1.5} name="Exits" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Employment type mix"
            description="All employee records"
            summary={metrics.byType.map((entry) => `${entry.label} ${entry.count}`).join(", ") + "."}
          >
            {metrics.byType.length === 0 ? (
              <EmptyState title="No employees" description="Add employees to see the composition." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={metrics.byType} dataKey="count" nameKey="label" innerRadius={62} outerRadius={100} paddingAngle={3}>
                    {metrics.byType.map((entry, index) => (
                      <Cell key={entry.type} fill={CHART_SERIES[index % CHART_SERIES.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Tenure distribution"
            description="Active employees by time since joining"
            summary={metrics.tenure.map((entry) => `${entry.label}: ${entry.count}`).join(", ") + "."}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={metrics.tenure}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="label" {...axisStyle} interval={0} angle={-12} textAnchor="end" height={54} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" fill={CHART_COLORS.workflow} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Headcount by department"
            description="All employee records"
            summary={metrics.byDepartment.map((entry) => `${entry.name} ${entry.count}`).join(", ") + "."}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={metrics.byDepartment} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid {...gridStyle} horizontal={false} vertical />
                <XAxis type="number" allowDecimals={false} {...axisStyle} />
                <YAxis type="category" dataKey="name" width={92} {...axisStyle} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {metrics.byTeam.length > 0 ? (
            <ChartCard
              title="Headcount by team"
              description={teamId === "all" ? "All teams · scope with the Team filter" : "Teams matching the current Team filter"}
              summary={metrics.byTeam.map((entry) => `${entry.name} ${entry.count}`).join(", ") + "."}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.byTeam} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid {...gridStyle} horizontal={false} vertical />
                  <XAxis type="number" allowDecimals={false} {...axisStyle} />
                  <YAxis type="category" dataKey="name" width={120} {...axisStyle} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill={CHART_COLORS.insight} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : null}
        </div>
      </QueryState>
    </div>
  );
}
