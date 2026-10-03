import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, ShieldAlert, Sparkles } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { CardSkeleton, EmptyState, QueryState } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, ToneBadge } from "@/components/shared/badges";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RiskEvidenceSheet, SignalDisclaimer } from "@/components/insights/risk-evidence-sheet";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeDirectory } from "@/hooks/use-lookups";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate } from "@/lib/format";
import { SIGNAL_TYPE_LABELS, type Insight, type Signal } from "@/lib/types";

export default function ExecutiveInsightsPage() {
  const { options: departmentOptions } = useDepartmentOptions();
  const { data: employees = [] } = useEmployeeDirectory();
  const [selected, setSelected] = useState<Signal | null>(null);

  useRealtimeRefresh(["hr_signals", "hr_ai_insights"], [["exec-insights"], ["insights"]]);

  const signalsQuery = useQuery<Signal[]>({
    queryKey: ["exec-insights"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_signals").select("*").order("score", { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Signal[];
    },
  });

  const insightsQuery = useQuery<Insight[]>({
    queryKey: ["exec-insight-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_ai_insights")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Insight[];
    },
  });

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const departmentById = useMemo(
    () => new Map(departmentOptions.map((option) => [option.value, option.label])),
    [departmentOptions],
  );

  const executiveRisks = useMemo(
    () => (signalsQuery.data ?? []).filter((signal) => Number(signal.score) >= 60),
    [signalsQuery.data],
  );

  const recommendations = useMemo(
    () => (insightsQuery.data ?? []).filter((insight) => insight.recommendation),
    [insightsQuery.data],
  );

  const entityLabel = (signal: Signal) =>
    signal.entity_type === "employee"
      ? employeeById.get(signal.entity_id)?.full_name ?? "Employee"
      : departmentById.get(signal.entity_id) ?? "Department";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Executive insights"
        description="High-level verified risks and recommendations with their evidence and stated limitations."
        breadcrumbs={[{ label: "Executive Overview", to: "/executive" }, { label: "AI Insights" }]}
      />

      <SignalDisclaimer />

      <QueryState
        isLoading={signalsQuery.isLoading || insightsQuery.isLoading}
        isError={signalsQuery.isError || insightsQuery.isError}
        onRetry={() => {
          void signalsQuery.refetch();
          void insightsQuery.refetch();
        }}
        loadingFallback={<CardSkeleton count={4} />}
      >
        <Tabs defaultValue="risks">
          <TabsList className="flex-wrap">
            <TabsTrigger value="risks">Verified risks ({executiveRisks.length})</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations ({recommendations.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="risks" className="space-y-4">
            <SectionHeader
              title="Risks requiring executive awareness"
              description="Signals scoring 60 or above across employees and departments"
            />
            {executiveRisks.length === 0 ? (
              <EmptyState
                title="No elevated risks"
                description="No verified signal currently scores 60 or above."
                icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
              />
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {executiveRisks.map((signal) => (
                  <li key={signal.id} className="glass flex flex-col rounded-lg border border-border p-5 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground">{entityLabel(signal)}</h3>
                        <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                          {SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type} · {signal.entity_type}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <RiskBadge score={signal.score} severity={signal.severity} />
                        <EvidenceQualityBadge quality={signal.evidence_quality} />
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-muted-foreground">{signal.explanation}</p>

                    {signal.recommendation ? (
                      <p className="mt-3 rounded-md border border-insight/25 bg-insight-soft px-3 py-2 text-sm text-foreground">
                        {signal.recommendation}
                      </p>
                    ) : null}

                    {signal.limitations ? (
                      <p className="mt-2 text-xs text-warning">Limitations: {signal.limitations}</p>
                    ) : null}

                    <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                      <span className="text-xs text-muted-foreground">
                        Formula {signal.formula_version} · detected {formatDate(signal.detected_at)}
                      </span>
                      <Button variant="outline" size="sm" className="ml-auto" onClick={() => setSelected(signal)}>
                        View evidence
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="recommendations" className="space-y-4">
            <SectionHeader
              title="Strategic recommendations"
              description="Each recommendation shows the verified evidence, the suggested next step and its limitations"
            />
            {recommendations.length === 0 ? (
              <EmptyState
                title="No recommendations"
                description="Recommendations are generated from verified signals."
                icon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
              />
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {recommendations.map((insight) => (
                  <li key={insight.id} className="flex flex-col rounded-lg border border-border bg-card p-5 shadow-card">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-insight-soft text-insight">
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-foreground">{insight.title}</h3>
                        <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                          {insight.category} · {insight.scope}
                        </p>
                      </div>
                      <EvidenceQualityBadge quality={insight.confidence} />
                    </div>

                    <p className="mt-3 text-sm text-muted-foreground">{insight.summary}</p>
                    <p className="mt-3 rounded-md border border-insight/25 bg-insight-soft px-3 py-2 text-sm text-foreground">
                      {insight.recommendation}
                    </p>
                    {insight.limitations ? (
                      <p className="mt-2 text-xs text-warning">Limitations: {insight.limitations}</p>
                    ) : null}
                    <p className="mt-3 text-xs text-muted-foreground">Generated {formatDate(insight.generated_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </QueryState>

      <RiskEvidenceSheet signal={selected} onClose={() => setSelected(null)} onCreateAction={() => undefined} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ToneBadge tone="neutral">Read-only</ToneBadge>
        Executive accounts review insight and evidence. Actions are created and owned by the HR team.
      </p>
    </div>
  );
}
