import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Lightbulb, PlusCircle, Sparkles, TrendingDown, Users } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState, ErrorState, QueryState, CardSkeleton } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, ToneBadge } from "@/components/shared/badges";
import { FilterBar, SearchInput, SelectFilter, ClearFiltersButton } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignalDisclaimer } from "@/components/insights/risk-evidence-sheet";
import { CreateActionDialog, type CreateActionSeed } from "@/components/insights/create-action-dialog";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeDirectory } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate, formatScore } from "@/lib/format";
import type { Insight, Signal } from "@/lib/types";

export default function OrganizationInsightsPage() {
  const { openEmployee360 } = useEmployee360();
  const { options: departmentOptions } = useDepartmentOptions();
  const { data: employees = [] } = useEmployeeDirectory();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [actionSeed, setActionSeed] = useState<CreateActionSeed | null>(null);

  useRealtimeRefresh(["hr_ai_insights", "hr_signals"], [["insights"], ["risk-signals"]]);

  const insightsQuery = useQuery<Insight[]>({
    queryKey: ["insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_ai_insights")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Insight[];
    },
  });

  const signalsQuery = useQuery<Signal[]>({
    queryKey: ["insights-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_signals")
        .select("*")
        .order("score", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Signal[];
    },
  });

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const departmentById = useMemo(
    () => new Map(departmentOptions.map((option) => [option.value, option.label])),
    [departmentOptions],
  );

  const filteredInsights = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (insightsQuery.data ?? []).filter((insight) => {
      if (scope !== "all" && insight.category !== scope) return false;
      if (!term) return true;
      return (
        insight.title.toLowerCase().includes(term) ||
        insight.summary.toLowerCase().includes(term) ||
        insight.category.toLowerCase().includes(term)
      );
    });
  }, [insightsQuery.data, scope, search]);

  const categories = useMemo(
    () => Array.from(new Set((insightsQuery.data ?? []).map((insight) => insight.category))),
    [insightsQuery.data],
  );

  const departmentComparison = useMemo(() => {
    const signals = signalsQuery.data ?? [];
    return signals
      .filter((signal) => signal.entity_type === "department" && signal.signal_type === "attendance_risk")
      .map((signal) => ({
        id: signal.entity_id,
        name: departmentById.get(signal.entity_id) ?? "Department",
        score: Number(signal.score),
        severity: signal.severity,
      }))
      .sort((a, b) => a.score - b.score);
  }, [departmentById, signalsQuery.data]);

  const topRisks = useMemo(
    () =>
      (signalsQuery.data ?? [])
        .filter((signal) => signal.entity_type === "employee" && signal.signal_type === "combined_risk")
        .slice(0, 8),
    [signalsQuery.data],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organization insights"
        description="Verified patterns across workforce, attendance, performance, recruitment, risk and actions."
        breadcrumbs={[{ label: "AI Insights", to: "/insights/organization" }, { label: "Organization Insights" }]}
      />

      <SignalDisclaimer />

      <QueryState
        isLoading={insightsQuery.isLoading}
        isError={insightsQuery.isError}
        onRetry={() => void insightsQuery.refetch()}
        loadingFallback={<CardSkeleton count={4} />}
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Verified insights" value={(insightsQuery.data ?? []).length} icon={Lightbulb} tone="insight" hint="Generated from stored data" />
          <KpiCard
            label="Employees above 60"
            value={
              (signalsQuery.data ?? []).filter(
                (signal) => signal.entity_type === "employee" && signal.signal_type === "combined_risk" && Number(signal.score) >= 60,
              ).length
            }
            icon={Users}
            tone="critical"
            hint="Combined risk"
          />
          <KpiCard
            label="Departments needing attention"
            value={
              (signalsQuery.data ?? []).filter(
                (signal) => signal.entity_type === "department" && signal.signal_type === "combined_risk" && Number(signal.score) >= 35,
              ).length
            }
            icon={Building2}
            tone="warning"
            hint="Medium risk or above"
          />
          <KpiCard
            label="Lowest attendance"
            value={departmentComparison[0]?.name ?? "—"}
            icon={TrendingDown}
            tone="workflow"
            hint={departmentComparison[0] ? `${formatScore(departmentComparison[0].score)} risk score` : "No data"}
          />
        </section>

        <Tabs defaultValue="insights">
          <TabsList className="flex-wrap">
            <TabsTrigger value="insights">Verified insights</TabsTrigger>
            <TabsTrigger value="departments">Department comparison</TabsTrigger>
            <TabsTrigger value="risks">Priority risks</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4">
            <FilterBar>
              <SearchInput value={search} onChange={setSearch} placeholder="Search insights…" />
              <SelectFilter
                label="Category"
                value={scope}
                onChange={setScope}
                options={categories.map((category) => ({ value: category, label: category }))}
              />
              <ClearFiltersButton
                visible={Boolean(search) || scope !== "all"}
                onClick={() => {
                  setSearch("");
                  setScope("all");
                }}
              />
            </FilterBar>

            {filteredInsights.length === 0 ? (
              <EmptyState
                title="No insights yet"
                description="Insights are produced by the risk engine from stored workforce data. Import attendance and submit reviews, then run the engine."
              />
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {filteredInsights.map((insight) => (
                  <li key={insight.id} className="glass flex flex-col rounded-lg border border-border p-5 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-insight-soft text-insight">
                          <Sparkles className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">{insight.title}</h3>
                          <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                            {insight.category} · {insight.scope}
                          </p>
                        </div>
                      </div>
                      <EvidenceQualityBadge quality={insight.confidence} />
                    </div>

                    <p className="mt-3 text-sm text-muted-foreground">{insight.summary}</p>

                    {insight.recommendation ? (
                      <p className="mt-3 rounded-md border border-insight/25 bg-insight-soft px-3 py-2 text-sm text-foreground">
                        {insight.recommendation}
                      </p>
                    ) : null}

                    {insight.limitations ? (
                      <p className="mt-2 text-xs text-warning">Limitations: {insight.limitations}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <span className="text-xs text-muted-foreground">Generated {formatDate(insight.generated_at)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={() =>
                          setActionSeed({
                            title: insight.recommendation ? insight.recommendation.slice(0, 110) : insight.title,
                            description: insight.summary,
                            source_type: "insight",
                            source_ref: insight.id,
                            recommendedPriority: insight.confidence === "strong" ? "high" : "medium",
                          })
                        }
                      >
                        <PlusCircle className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        Create action
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="departments" className="space-y-4">
            <SectionHeader
              title="Department attendance comparison"
              description="Ranked from lowest attendance risk to highest — department-level signals computed by the backend"
            />
            {departmentComparison.length === 0 ? (
              <EmptyState title="No department signals" description="Department signals appear once attendance has been imported." />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
                {departmentComparison.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">Attendance risk signal</p>
                    </div>
                    <RiskBadge score={entry.score} severity={entry.severity} />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="risks" className="space-y-4">
            <SectionHeader title="Priority risks" description="Highest combined-risk employees" />
            {topRisks.length === 0 ? (
              <EmptyState title="No elevated risks" description="No employee currently scores 60 or above on combined risk." />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
                {topRisks.map((signal) => {
                  const employee = employeeById.get(signal.entity_id);
                  return (
                    <li key={signal.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="truncate text-left text-sm font-medium hover:text-primary"
                          onClick={() => openEmployee360(signal.entity_id)}
                        >
                          {employee?.full_name ?? "Employee"}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">{signal.explanation}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiskBadge score={signal.score} severity={signal.severity} />
                        <Button variant="outline" size="sm" onClick={() => openEmployee360(signal.entity_id)}>
                          Open 360°
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </QueryState>

      <CreateActionDialog open={Boolean(actionSeed)} onOpenChange={(open) => (!open ? setActionSeed(null) : undefined)} seed={actionSeed} />
    </div>
  );
}
