import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ExternalLink, PlusCircle, ShieldAlert } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { CardSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, ToneBadge } from "@/components/shared/badges";
import { ClearFiltersButton, FilterBar, SearchInput, SelectFilter } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { RiskEvidenceSheet, SignalDisclaimer } from "@/components/insights/risk-evidence-sheet";
import { CreateActionDialog, type CreateActionSeed } from "@/components/insights/create-action-dialog";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeDirectory, useTeamOptions } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate } from "@/lib/format";
import {
  EVIDENCE_QUALITY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  SIGNAL_TYPE_LABELS,
  SIGNAL_TYPE_OPTIONS,
  type Signal,
} from "@/lib/types";

export default function RiskMonitorPage() {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const { openEmployee360 } = useEmployee360();
  const { options: departmentOptions } = useDepartmentOptions();
  const { data: employees = [] } = useEmployeeDirectory();
  const [searchParams, setSearchParams] = useSearchParams();

  const [severity, setSeverity] = useState("all");
  const [signalType, setSignalType] = useState("all");
  const [department, setDepartment] = useState("all");
  const [team, setTeam] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Signal | null>(null);
  const [actionSeed, setActionSeed] = useState<CreateActionSeed | null>(null);
  const { options: teamOptions } = useTeamOptions(department === "all" ? null : department);

  useRealtimeRefresh(["hr_signals"], [["risk-signals"]]);

  const { data: signals = [], isLoading, isError, refetch } = useQuery<Signal[]>({
    queryKey: ["risk-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_signals")
        .select("*")
        .order("score", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Signal[];
    },
  });

  // Query-string entry points from the dashboard and other modules.
  useEffect(() => {
    const severityParam = searchParams.get("severity");
    const employeeParam = searchParams.get("employee");
    const departmentParam = searchParams.get("department");
    if (!severityParam && !employeeParam && !departmentParam) return;
    if (severityParam === "high") setSeverity("high");
    if (employeeParam) setEmployeeFilter(employeeParam);
    if (departmentParam) setDepartment(departmentParam);
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [searchParams, setSearchParams]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const departmentById = useMemo(
    () => new Map(departmentOptions.map((option) => [option.value, option.label])),
    [departmentOptions],
  );

  const teamMemberIds = useMemo(
    () => new Set(employees.filter((employee) => employee.team_id === team).map((employee) => employee.id)),
    [employees, team],
  );

  const scoped = useMemo(
    () =>
      signals.filter((signal) => {
        if (severity !== "all" && signal.severity !== severity) return false;
        if (signalType !== "all" && signal.signal_type !== signalType) return false;
        if (team !== "all") {
          if (signal.entity_type === "department") return false;
          if (!teamMemberIds.has(signal.entity_id)) return false;
        }
        if (department !== "all") {
          if (signal.entity_type === "department") {
            if (signal.entity_id !== department) return false;
          } else {
            const employee = employeeById.get(signal.entity_id);
            if (employee?.department_id !== department) return false;
          }
        }
        if (employeeFilter !== "all" && signal.entity_id !== employeeFilter) return false;

        const term = search.trim().toLowerCase();
        if (!term) return true;
        const entityLabel =
          signal.entity_type === "employee"
            ? employeeById.get(signal.entity_id)?.full_name ?? ""
            : departmentById.get(signal.entity_id) ?? "";
        return (
          entityLabel.toLowerCase().includes(term) ||
          (signal.explanation ?? "").toLowerCase().includes(term) ||
          (SIGNAL_TYPE_LABELS[signal.signal_type] ?? "").toLowerCase().includes(term)
        );
      }),
    [department, departmentById, employeeById, employeeFilter, search, severity, signalType, signals, team, teamMemberIds],
  );

  const counts = useMemo(() => {
    const employeeSignals = signals.filter((signal) => signal.entity_type === "employee");
    return {
      critical: signals.filter((signal) => signal.severity === "critical").length,
      high: signals.filter((signal) => signal.severity === "high").length,
      medium: signals.filter((signal) => signal.severity === "medium").length,
      employeesAbove60: employeeSignals.filter(
        (signal) => signal.signal_type === "combined_risk" && Number(signal.score) >= 60,
      ).length,
      insufficient: signals.filter((signal) => signal.evidence_quality === "insufficient").length,
    };
  }, [signals]);

  const columns: Column<Signal>[] = [
    {
      key: "entity",
      header: "Affected",
      sortValue: (row) =>
        row.entity_type === "employee"
          ? employeeById.get(row.entity_id)?.full_name ?? ""
          : departmentById.get(row.entity_id) ?? "",
      cell: (row) => {
        const employee = row.entity_type === "employee" ? employeeById.get(row.entity_id) : undefined;
        const label = employee?.full_name ?? departmentById.get(row.entity_id) ?? "Unknown";
        return (
          <div className="min-w-0">
            <button
              type="button"
              className="truncate text-left font-medium hover:text-primary"
              onClick={() => (employee ? openEmployee360(employee.id) : setSelected(row))}
            >
              {label}
            </button>
            <p className="truncate text-xs text-muted-foreground">
              {row.entity_type === "employee" ? employee?.job_title ?? "Employee" : "Department"}
            </p>
          </div>
        );
      },
    },
    {
      key: "signal_type",
      header: "Risk type",
      sortValue: (row) => row.signal_type,
      cell: (row) => <ToneBadge tone="workflow">{SIGNAL_TYPE_LABELS[row.signal_type] ?? row.signal_type}</ToneBadge>,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortValue: (row) => Number(row.score),
      cell: (row) => <RiskBadge score={row.score} severity={row.severity} />,
    },
    {
      key: "evidence_quality",
      header: "Evidence",
      sortValue: (row) => row.evidence_quality,
      cell: (row) => <EvidenceQualityBadge quality={row.evidence_quality} />,
      hideBelow: "md",
    },
    {
      key: "detected_at",
      header: "Detected",
      sortValue: (row) => row.detected_at,
      cell: (row) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.detected_at)}</span>,
      hideBelow: "lg",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => setSelected(row)}>
            Evidence
          </Button>
          {isHr ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Create action from signal"
              onClick={() =>
                setActionSeed({
                  title: `Address ${SIGNAL_TYPE_LABELS[row.signal_type] ?? "risk"} for ${
                    row.entity_type === "employee"
                      ? employeeById.get(row.entity_id)?.full_name ?? "employee"
                      : departmentById.get(row.entity_id) ?? "department"
                  }`,
                  description: row.explanation ?? undefined,
                  source_type: "signal",
                  source_ref: row.id,
                  recommendedPriority: row.severity === "critical" ? "critical" : row.severity === "high" ? "high" : "medium",
                  sensitive: false,
                })
              }
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const hasFilters =
    severity !== "all" || signalType !== "all" || department !== "all" || team !== "all" || employeeFilter !== "all" || Boolean(search);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Risk monitor"
        description="Every verified workforce signal with its score, severity, evidence quality and recommendation."
        breadcrumbs={[{ label: "AI Insights", to: "/insights/organization" }, { label: "Risk Monitor" }]}
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href="/insights/recommendations">View recommendations</a>
          </Button>
        }
      />

      <SignalDisclaimer />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={<CardSkeleton count={4} />}
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Critical signals" value={counts.critical} icon={ShieldAlert} tone="critical" onClick={() => setSeverity("critical")} hint="Score 80–100" />
          <KpiCard label="High signals" value={counts.high} icon={AlertTriangle} tone="warning" onClick={() => setSeverity("high")} hint="Score 60–79" />
          <KpiCard label="Medium signals" value={counts.medium} icon={Activity} tone="info" onClick={() => setSeverity("medium")} hint="Score 35–59" />
          <KpiCard
            label="Employees above 60"
            value={counts.employeesAbove60}
            icon={ShieldAlert}
            tone="critical"
            hint="Combined risk"
            onClick={() => setSignalType("combined_risk")}
          />
          <KpiCard
            label="Insufficient data"
            value={counts.insufficient}
            icon={Activity}
            tone="neutral"
            hint="Evidence quality"
            onClick={() => setSignalType("all")}
          />
        </section>

        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search entity, risk type or explanation…" />
          <SelectFilter
            label="Risk type"
            value={signalType}
            onChange={setSignalType}
            options={SIGNAL_TYPE_OPTIONS.map((option) => ({ value: option, label: SIGNAL_TYPE_LABELS[option] }))}
          />
          <SelectFilter
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={SEVERITY_OPTIONS.map((option) => ({ value: option, label: SEVERITY_LABELS[option] }))}
          />
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
            label="Employee"
            value={employeeFilter}
            onChange={setEmployeeFilter}
            options={employees.slice(0, 300).map((employee) => ({ value: employee.id, label: employee.full_name }))}
            allLabel="All employees"
          />
          <ClearFiltersButton
            visible={hasFilters}
            onClick={() => {
              setSearch("");
              setSeverity("all");
              setSignalType("all");
              setDepartment("all");
              setTeam("all");
              setEmployeeFilter("all");
            }}
          />
        </FilterBar>

        <section className="space-y-3">
          <SectionHeader title="Signals" description={`${scoped.length} signals match the current filters`} />
          <DataTable
            columns={columns}
            rows={scoped}
            getRowId={(row) => row.id}
            initialSort={{ key: "score", direction: "desc" }}
            pageSize={15}
            caption="Workforce risk signals"
            emptyState={
              <EmptyState
                title="No signals match these filters"
                description="Adjust the severity, risk type or scope filters. If the workforce has no data yet, run the risk engine after importing attendance and performance."
                icon={<Activity className="h-5 w-5" aria-hidden="true" />}
              />
            }
          />
        </section>
      </QueryState>

      <RiskEvidenceSheet
        signal={selected}
        onClose={() => setSelected(null)}
        onCreateAction={(signal) => {
          const employee = signal.entity_type === "employee" ? employeeById.get(signal.entity_id) : undefined;
          setActionSeed({
            title: `Address ${SIGNAL_TYPE_LABELS[signal.signal_type] ?? "risk"} for ${
              employee?.full_name ?? departmentById.get(signal.entity_id) ?? "workforce"
            }`,
            description: signal.explanation ?? undefined,
            source_type: "signal",
            source_ref: signal.id,
            recommendedPriority: signal.severity === "critical" ? "critical" : signal.severity === "high" ? "high" : "medium",
            sensitive: false,
          });
        }}
      />

      <CreateActionDialog open={Boolean(actionSeed)} onOpenChange={(open) => (!open ? setActionSeed(null) : undefined)} seed={actionSeed} />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        Evidence is read from stored records; {EVIDENCE_QUALITY_LABELS.insufficient} is shown rather than estimating.
      </p>
    </div>
  );
}
