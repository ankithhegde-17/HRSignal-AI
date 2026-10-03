import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Building2, Globe, Laptop, MapPin, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CardSkeleton, ChartSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/badges";
import { supabase } from "@/lib/db";
import { useDepartmentOptions } from "@/hooks/use-lookups";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { WORK_MODE_LABELS, WORK_MODE_TONE, type Employee, type WorkMode } from "@/lib/types";
import { CHART_COLORS, axisStyle, gridStyle, tooltipStyle } from "@/lib/chart-theme";

const MODE_COLORS: Record<WorkMode, string> = {
  onsite: CHART_COLORS.primary,
  remote: CHART_COLORS.insight,
  hybrid: CHART_COLORS.workflow,
};

interface LocationRow {
  location: string;
  onsite: number;
  remote: number;
  hybrid: number;
  total: number;
}

export default function WorkforceWorkModePage() {
  const { options: departmentOptions } = useDepartmentOptions();
  useRealtimeRefresh(["hr_employees"], [["workforce-work-mode"]]);

  const { data: employees = [], isLoading, isError, refetch } = useQuery<Employee[]>({
    queryKey: ["workforce-work-mode"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").neq("status", "exited").limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  const metrics = useMemo(() => {
    const count = (mode: WorkMode) => employees.filter((employee) => employee.work_mode === mode).length;
    const total = employees.length;

    const modeTotals = (["onsite", "remote", "hybrid"] as WorkMode[]).map((mode) => ({
      mode,
      label: WORK_MODE_LABELS[mode],
      count: count(mode),
      share: total ? Math.round((count(mode) / total) * 1000) / 10 : 0,
    }));

    const departmentRows = departmentOptions.map((option) => {
      const members = employees.filter((employee) => employee.department_id === option.value);
      return {
        name: option.label,
        onsite: members.filter((employee) => employee.work_mode === "onsite").length,
        remote: members.filter((employee) => employee.work_mode === "remote").length,
        hybrid: members.filter((employee) => employee.work_mode === "hybrid").length,
        total: members.length,
      };
    }).filter((row) => row.total > 0);

    const byLocation = new Map<string, LocationRow>();
    employees.forEach((employee) => {
      const key = employee.location ?? "Unspecified";
      if (!byLocation.has(key)) byLocation.set(key, { location: key, onsite: 0, remote: 0, hybrid: 0, total: 0 });
      const entry = byLocation.get(key)!;
      entry[employee.work_mode] += 1;
      entry.total += 1;
    });
    const locationRows = Array.from(byLocation.values()).sort((a, b) => b.total - a.total);

    return { total, modeTotals, departmentRows, locationRows };
  }, [departmentOptions, employees]);

  const locationColumns: Column<LocationRow>[] = [
    { key: "location", header: "Location", sortValue: (row) => row.location, cell: (row) => <span className="font-medium">{row.location}</span> },
    { key: "onsite", header: "Onsite", align: "right", sortValue: (row) => row.onsite, cell: (row) => <span className="tabular-nums">{row.onsite}</span> },
    { key: "remote", header: "Remote", align: "right", sortValue: (row) => row.remote, cell: (row) => <span className="tabular-nums">{row.remote}</span> },
    { key: "hybrid", header: "Hybrid", align: "right", sortValue: (row) => row.hybrid, cell: (row) => <span className="tabular-nums">{row.hybrid}</span> },
    { key: "total", header: "Total", align: "right", sortValue: (row) => row.total, cell: (row) => <span className="tabular-nums font-medium">{row.total}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Work mode"
        description="Onsite, remote and hybrid distribution across departments and locations."
        breadcrumbs={[{ label: "Workforce", to: "/workforce/employees" }, { label: "Work Mode" }]}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={
          <div className="space-y-5">
            <CardSkeleton count={3} />
            <ChartSkeleton />
          </div>
        }
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Active workforce" value={metrics.total} icon={Users} tone="primary" hint="Excludes exited employees" />
          {metrics.modeTotals.map((entry, index) => (
            <KpiCard
              key={entry.mode}
              label={entry.label}
              value={entry.count}
              icon={index === 0 ? MapPin : index === 1 ? Globe : Laptop}
              tone={index === 0 ? "primary" : index === 1 ? "insight" : "workflow"}
              hint={`${entry.share}% of workforce`}
            />
          ))}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Work mode share"
            description="Active employees by arrangement"
            summary={metrics.modeTotals.map((entry) => `${entry.label} ${entry.count} employees`).join(", ") + "."}
          >
            {metrics.total === 0 ? (
              <EmptyState title="No active employees" description="Add employees to see the distribution." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={metrics.modeTotals}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={62}
                    outerRadius={100}
                    paddingAngle={3}
                  >
                    {metrics.modeTotals.map((entry) => (
                      <Cell key={entry.mode} fill={MODE_COLORS[entry.mode]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Work mode by department"
            description="Stacked headcount per department"
            summary={`Work mode split by department: ${metrics.departmentRows
              .map((row) => `${row.name} onsite ${row.onsite}, remote ${row.remote}, hybrid ${row.hybrid}`)
              .join("; ")}.`}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={metrics.departmentRows}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="name" {...axisStyle} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} {...axisStyle} width={32} />
                <Tooltip {...tooltipStyle} />
                <Legend />
                <Bar dataKey="onsite" stackId="mode" fill={MODE_COLORS.onsite} name="Onsite" />
                <Bar dataKey="remote" stackId="mode" fill={MODE_COLORS.remote} name="Remote" />
                <Bar dataKey="hybrid" stackId="mode" fill={MODE_COLORS.hybrid} name="Hybrid" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">By location</h2>
          </div>
          <DataTable
            columns={locationColumns}
            rows={metrics.locationRows}
            getRowId={(row) => row.location}
            initialSort={{ key: "total", direction: "desc" }}
            pageSize={10}
            caption="Work mode by location"
            emptyState={<EmptyState title="No locations recorded" description="Add employee locations to see this breakdown." />}
          />
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Legend:</span>
          {(["onsite", "remote", "hybrid"] as WorkMode[]).map((mode) => (
            <StatusBadge key={mode} value={mode} labels={WORK_MODE_LABELS} tones={WORK_MODE_TONE} />
          ))}
        </div>
      </QueryState>
    </div>
  );
}
