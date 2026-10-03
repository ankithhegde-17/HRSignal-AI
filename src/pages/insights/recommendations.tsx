import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, PlusCircle, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, CardSkeleton, QueryState } from "@/components/shared/states";
import { EvidenceQualityBadge, RiskBadge, ToneBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { SignalDisclaimer } from "@/components/insights/risk-evidence-sheet";
import { CreateActionDialog, type CreateActionSeed } from "@/components/insights/create-action-dialog";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeDirectory } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { SIGNAL_TYPE_LABELS, type Signal } from "@/lib/types";

interface Recommendation {
  id: string;
  scope: string;
  reason: string;
  nextStep: string;
  limitations: string | null;
  evidenceSnapshot: Record<string, unknown>;
  severity: string;
  score: number;
  signalType: string;
  entityLabel: string;
  entityId: string;
  entityType: "employee" | "department";
  evidenceQuality: Signal["evidence_quality"];
}

export default function RecommendationsPage() {
  const { openEmployee360 } = useEmployee360();
  const { options: departmentOptions } = useDepartmentOptions();
  const { data: employees = [] } = useEmployeeDirectory();
  const [actionSeed, setActionSeed] = useState<CreateActionSeed | null>(null);

  useRealtimeRefresh(["hr_signals", "hr_ai_insights"], [["recommendation-signals"], ["insights"]]);

  const signalsQuery = useQuery<Signal[]>({
    queryKey: ["recommendation-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_signals")
        .select("*")
        .not("recommendation", "is", null)
        .order("score", { ascending: false })
        .limit(400);
      if (error) throw new Error(error.message);
      return (data ?? []) as Signal[];
    },
  });

  const insightsQuery = useQuery({
    queryKey: ["recommendation-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_ai_insights")
        .select("*")
        .not("recommendation", "is", null)
        .order("generated_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const recommendations = useMemo<Recommendation[]>(() => {
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const departmentById = new Map(departmentOptions.map((option) => [option.value, option.label]));

    const fromSignals: Recommendation[] = (signalsQuery.data ?? [])
      .filter((signal) => Number(signal.score) >= 35)
      .map((signal) => ({
        id: `signal-${signal.id}`,
        scope: signal.entity_type === "employee"
          ? employeeById.get(signal.entity_id)?.full_name ?? "Employee"
          : departmentById.get(signal.entity_id) ?? "Department",
        reason: signal.explanation ?? "Verified metrics exceeded the configured threshold.",
        nextStep: signal.recommendation ?? "Review the evidence and agree a next step.",
        limitations: signal.limitations,
        evidenceSnapshot: signal.evidence ?? {},
        severity: signal.severity,
        score: Number(signal.score),
        signalType: SIGNAL_TYPE_LABELS[signal.signal_type] ?? signal.signal_type,
        entityLabel: signal.entity_type === "employee"
          ? employeeById.get(signal.entity_id)?.full_name ?? "Employee"
          : departmentById.get(signal.entity_id) ?? "Department",
        entityId: signal.entity_id,
        entityType: signal.entity_type,
        evidenceQuality: signal.evidence_quality,
      }));

    const fromInsights: Recommendation[] = (insightsQuery.data ?? []).map((insight) => ({
      id: `insight-${insight.id}`,
      scope: insight.scope === "organization" ? "Organisation-wide" : insight.scope,
      reason: insight.summary,
      nextStep: insight.recommendation ?? "Review the supporting evidence.",
      limitations: insight.limitations,
      evidenceSnapshot: insight.verified_evidence ?? {},
      severity: insight.confidence === "strong" ? "high" : "medium",
      score: 0,
      signalType: insight.category,
      entityLabel: insight.title,
      entityId: insight.id,
      entityType: "department",
      evidenceQuality: insight.confidence,
    }));

    return [...fromInsights, ...fromSignals];
  }, [departmentOptions, employees, insightsQuery.data, signalsQuery.data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recommendations"
        description="Each recommendation states the verified evidence, the reason, the affected scope, the suggested next step and its limitations."
        breadcrumbs={[{ label: "AI Insights", to: "/insights/organization" }, { label: "Recommendations" }]}
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
        {recommendations.length === 0 ? (
          <EmptyState
            title="No recommendations yet"
            description="Recommendations are generated from verified signals. Once attendance and performance data exist, the risk engine produces them."
            icon={<Compass className="h-5 w-5" aria-hidden="true" />}
          />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {recommendations.map((recommendation) => (
              <li key={recommendation.id} className="glass flex flex-col rounded-lg border border-border p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-insight-soft text-insight">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">{recommendation.signalType}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">Affected scope: {recommendation.scope}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {recommendation.score > 0 ? (
                      <RiskBadge score={recommendation.score} severity={recommendation.severity as Signal["severity"]} />
                    ) : (
                      <ToneBadge tone="insight">Organisation</ToneBadge>
                    )}
                    <EvidenceQualityBadge quality={recommendation.evidenceQuality} />
                  </div>
                </div>

                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Verified evidence</dt>
                    <dd className="mt-0.5 text-muted-foreground">{recommendation.reason}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Suggested next step</dt>
                    <dd className="mt-0.5 rounded-md border border-insight/25 bg-insight-soft px-3 py-2 text-foreground">
                      {recommendation.nextStep}
                    </dd>
                  </div>
                  {recommendation.limitations ? (
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Limitations</dt>
                      <dd className="mt-0.5 text-warning">{recommendation.limitations}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {recommendation.entityType === "employee" && recommendation.id.startsWith("signal-") ? (
                    <Button variant="outline" size="sm" onClick={() => openEmployee360(recommendation.entityId)}>
                      Open 360°
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() =>
                      setActionSeed({
                        title: recommendation.nextStep.slice(0, 120),
                        description: `${recommendation.reason}\n\nAffected scope: ${recommendation.scope}. Evidence quality: ${recommendation.evidenceQuality}.`,
                        source_type: recommendation.id.startsWith("insight-") ? "insight" : "recommendation",
                        source_ref: recommendation.id.split("-").slice(1).join("-"),
                        recommendedPriority:
                          recommendation.severity === "critical" ? "critical" : recommendation.severity === "high" ? "high" : "medium",
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
      </QueryState>

      <CreateActionDialog open={Boolean(actionSeed)} onOpenChange={(open) => (!open ? setActionSeed(null) : undefined)} seed={actionSeed} />
    </div>
  );
}
