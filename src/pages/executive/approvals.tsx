import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Eye, ShieldCheck, Timer, XCircle } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { CardSkeleton, EmptyState, ErrorState, QueryState } from "@/components/shared/states";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionDetailSheet } from "@/components/actions/action-detail-sheet";
import { supabase } from "@/lib/db";
import { useHrProfiles } from "@/hooks/use-lookups";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUS_TONE,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  type Approval,
  type HrAction,
} from "@/lib/types";

interface ApprovalRow {
  approval: Approval;
  action: HrAction | null;
}

export default function ExecutiveApprovalsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: hrProfiles = [] } = useHrProfiles();

  const [decision, setDecision] = useState<{ approvalId: string; actionTitle: string; type: "approved" | "rejected" } | null>(null);
  const [notes, setNotes] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  useRealtimeRefresh(["hr_approvals", "hr_actions"], [["approvals"], ["actions"]]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => {
      const [approvals, actions] = await Promise.all([
        supabase.from("hr_approvals").select("*").order("requested_at", { ascending: false }).limit(300),
        supabase.from("hr_actions").select("*").limit(300),
      ]);
      if (approvals.error) throw new Error(approvals.error.message);
      if (actions.error) throw new Error(actions.error.message);
      const actionById = new Map(((actions.data ?? []) as HrAction[]).map((action) => [action.id, action]));
      return {
        rows: ((approvals.data ?? []) as Approval[]).map((approval) => ({
          approval,
          action: actionById.get(approval.action_id) ?? null,
        })) as ApprovalRow[],
        actions: (actions.data ?? []) as HrAction[],
      };
    },
  });

  const decide = useMutation({
    mutationFn: async ({ approvalId, type }: { approvalId: string; type: "approved" | "rejected" }) => {
      const { data: result, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("action-workflow", {
        body: {
          action: "decide",
          approval_id: approvalId,
          decision: type,
          decision_notes: notes.trim() || null,
        },
        headers: { "Content-Type": "application/json" },
      });
      if (error) throw new Error(error.message);
      if (!result?.ok) throw new Error(result?.message ?? "The decision could not be recorded.");
      return result;
    },
    onSuccess: (_result, variables) => {
      toast.success(variables.type === "approved" ? "Action approved and returned to HR." : "Action rejected with your notes.");
      setDecision(null);
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
      void queryClient.invalidateQueries({ queryKey: ["executive-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const pending = useMemo(() => rows.filter((row) => row.approval.decision === "pending"), [rows]);
  const decided = useMemo(() => rows.filter((row) => row.approval.decision !== "pending"), [rows]);

  const counts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      pending: pending.length,
      approved: rows.filter((row) => row.approval.decision === "approved").length,
      rejected: rows.filter((row) => row.approval.decision === "rejected").length,
      overdue: pending.filter((row) => row.action?.due_date && row.action.due_date < today).length,
    };
  }, [pending, rows]);

  const requesterName = (userId: string | null) =>
    userId ? hrProfiles.find((profileRow) => profileRow.user_id === userId)?.full_name ?? "Unknown" : "System";

  const renderRow = (row: ApprovalRow, actionable: boolean) => (
    <li key={row.approval.id} className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{row.action?.title ?? "Action"}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Requested by {requesterName(row.approval.requested_by)} · {formatDateTime(row.approval.requested_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.action ? (
            <>
              <StatusBadge value={row.action.status} labels={ACTION_STATUS_LABELS} tones={ACTION_STATUS_TONE} />
              <StatusBadge value={row.action.priority} labels={PRIORITY_LABELS} tones={PRIORITY_TONE} />
            </>
          ) : null}
          <ToneBadge
            tone={row.approval.decision === "approved" ? "success" : row.approval.decision === "rejected" ? "critical" : "warning"}
            showIcon
          >
            {row.approval.decision}
          </ToneBadge>
        </div>
      </div>

      {row.action?.description ? (
        <p className="text-sm text-muted-foreground">{row.action.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {row.action?.sensitivity === "sensitive" ? (
          <ToneBadge tone="warning">
            <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
            Sensitive — approval required by policy
          </ToneBadge>
        ) : null}
        {row.action?.due_date ? (
          <span className="text-xs text-muted-foreground">Due {formatDateTime(row.action.due_date)}</span>
        ) : null}
        {row.action ? (
          <Button variant="outline" size="sm" onClick={() => setDetailId(row.action!.id)}>
            <Eye className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Evidence & history
          </Button>
        ) : null}
      </div>

      {row.approval.decision_notes ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Decision notes: </span>
          {row.approval.decision_notes}
        </p>
      ) : null}

      {actionable ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            onClick={() => {
              setNotes("");
              setDecision({ approvalId: row.approval.id, actionTitle: row.action?.title ?? "this action", type: "approved" });
            }}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setNotes("");
              setDecision({ approvalId: row.approval.id, actionTitle: row.action?.title ?? "this action", type: "rejected" });
            }}
          >
            <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
          <span className="text-xs text-muted-foreground">
            Approving releases the work to HR. Rejecting returns it with your notes.
          </span>
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approvals"
        description="Sensitive workforce actions awaiting your decision, with the supporting evidence and full history."
        breadcrumbs={[{ label: "Executive Overview", to: "/executive" }, { label: "Approvals" }]}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={<CardSkeleton count={4} />}
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Pending decisions" value={counts.pending} icon={ClipboardCheck} tone={counts.pending > 0 ? "warning" : "success"} hint="Awaiting you" />
          <KpiCard label="Approved" value={counts.approved} icon={CheckCircle2} tone="success" hint="Released to HR" />
          <KpiCard label="Rejected" value={counts.rejected} icon={XCircle} tone="critical" hint="Returned with notes" />
          <KpiCard label="Overdue requests" value={counts.overdue} icon={Timer} tone={counts.overdue > 0 ? "critical" : "success"} hint="Past the action due date" />
        </section>

        <Tabs defaultValue="pending">
          <TabsList className="flex-wrap">
            <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
            <TabsTrigger value="decided">Decision history ({decided.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            <SectionHeader
              title="Awaiting your decision"
              description="Open the evidence and history before deciding. Every decision is recorded with your notes and timestamp."
            />
            {pending.length === 0 ? (
              <EmptyState
                title="No pending approvals"
                description="Nothing is waiting on you. Sensitive actions will appear here as soon as HR requests approval."
                icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
                {pending.map((row) => renderRow(row, true))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="decided" className="space-y-4">
            <SectionHeader title="Decision history" description="Every approval decision with its notes and recorded outcome" />
            {decided.length === 0 ? (
              <EmptyState title="No decisions yet" description="Decisions you record will be listed here with their notes." />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
                {decided.map((row) => renderRow(row, false))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        {isError ? <ErrorState onRetry={() => void refetch()} /> : null}
      </QueryState>

      <ActionDetailSheet actionId={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={Boolean(decision)}
        onOpenChange={(open) => (!open ? setDecision(null) : undefined)}
        title={decision?.type === "approved" ? "Approve this action?" : "Reject this action?"}
        description={
          decision?.type === "approved" ? (
            <>
              <span className="font-medium text-foreground">{decision?.actionTitle}</span> will be released to the HR
              team, and the requester is notified. Your decision — {profile?.full_name ?? "Founder/CEO"} — and the
              timestamp are written to the audit history.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{decision?.actionTitle}</span> will be returned to HR with
              your notes. Nothing is deleted; the rejection is recorded in the workflow and audit history.
            </>
          )
        }
        confirmLabel={decision?.type === "approved" ? "Approve action" : "Reject action"}
        destructive={decision?.type === "rejected"}
        busy={decide.isPending}
        onConfirm={() => decision && decide.mutate({ approvalId: decision.approvalId, type: decision.type })}
      >
        <div className="space-y-1.5">
          <Label htmlFor="decision-notes" className="text-xs font-medium text-muted-foreground">
            {decision?.type === "approved" ? "Notes (optional)" : "Decision notes"}
          </Label>
          <Textarea
            id="decision-notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={
              decision?.type === "approved"
                ? "Any conditions attached to this approval"
                : "Explain the reason for rejection so HR can act on it"
            }
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
