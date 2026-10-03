import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Gauge, Loader2, MessageSquarePlus, Send, ShieldCheck, XCircle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { supabase } from "@/lib/db";
import { useHrProfiles } from "@/hooks/use-lookups";
import { useAuth } from "@/providers/auth-provider";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUS_TONE,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  type Approval,
  type HrAction,
  type WorkflowEvent,
} from "@/lib/types";

interface ActionDetailSheetProps {
  actionId: string | null;
  onClose: () => void;
}

export function ActionDetailSheet({ actionId, onClose }: ActionDetailSheetProps) {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const isFounder = profile?.role === "founder";
  const queryClient = useQueryClient();
  const { data: hrProfiles = [] } = useHrProfiles();

  const [comment, setComment] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<"request_approval" | "approve" | "reject" | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");

  const actionQuery = useQuery({
    queryKey: ["action-detail", actionId],
    enabled: Boolean(actionId),
    queryFn: async () => {
      const [action, approvals, events] = await Promise.all([
        supabase.from("hr_actions").select("*").eq("id", actionId).maybeSingle(),
        supabase.from("hr_approvals").select("*").eq("action_id", actionId).order("requested_at", { ascending: false }),
        supabase.from("hr_workflow_events").select("*").eq("action_id", actionId).order("created_at", { ascending: true }),
      ]);
      if (action.error) throw new Error(action.error.message);
      return {
        action: action.data as HrAction | null,
        approvals: (approvals.data ?? []) as Approval[],
        events: (events.data ?? []) as WorkflowEvent[],
      };
    },
  });

  const auditQuery = useQuery({
    queryKey: ["action-audit", actionId],
    enabled: Boolean(actionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_audit_log")
        .select("*")
        .eq("entity_id", actionId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const action = actionQuery.data?.action ?? null;
  const pendingApproval = (actionQuery.data?.approvals ?? []).find((approval) => approval.decision === "pending") ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["action-detail", actionId] });
    void queryClient.invalidateQueries({ queryKey: ["action-audit", actionId] });
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
    void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const runWorkflow = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("action-workflow", {
        body: payload,
        headers: { "Content-Type": "application/json" },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.message ?? "The workflow step was rejected.");
      return data;
    },
    onSuccess: (_result, variables) => {
      const verb = String((variables as { action?: string }).action ?? "updated");
      toast.success(
        verb === "request_approval"
          ? "Approval requested. The Founder/CEO has been notified."
          : verb === "decide"
            ? "Decision recorded and returned to HR."
            : verb === "assign"
              ? "Owner updated."
              : verb === "comment"
                ? "Comment added to the workflow timeline."
                : "Action updated.",
      );
      setComment("");
      setResolutionNotes("");
      setPendingAction(null);
      setResolveOpen(false);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canStartWork =
    action &&
    isHr &&
    ["approved", "under_review", "new"].includes(action.status) &&
    (!action.approval_required || action.status === "approved");

  return (
    <>
      <Sheet open={Boolean(actionId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto p-0 sm:max-w-2xl">
          {actionQuery.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading action…
            </div>
          ) : actionQuery.isError ? (
            <div className="p-6">
              <ErrorState onRetry={() => void actionQuery.refetch()} />
            </div>
          ) : !action ? (
            <div className="p-6">
              <EmptyState title="Action not found" description="This action may have been removed." />
            </div>
          ) : (
            <>
              <SheetHeader className="border-b border-border px-6 py-5 text-left">
                <SheetTitle className="text-lg">{action.title}</SheetTitle>
                <SheetDescription>{action.description ?? "No description recorded."}</SheetDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge value={action.status} labels={ACTION_STATUS_LABELS} tones={ACTION_STATUS_TONE} showIcon />
                  <StatusBadge value={action.priority} labels={PRIORITY_LABELS} tones={PRIORITY_TONE} />
                  <ToneBadge tone={action.sensitivity === "sensitive" ? "warning" : "neutral"}>
                    {action.sensitivity === "sensitive" ? "Sensitive" : "Routine"}
                  </ToneBadge>
                  {action.approval_required ? <ToneBadge tone="warning">Approval required</ToneBadge> : null}
                </div>
              </SheetHeader>

              <div className="space-y-4 px-6 py-5">
                <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase text-muted-foreground">Owner</dt>
                    <dd>
                      {hrProfiles.find((profileRow) => profileRow.user_id === action.assigned_to)?.full_name ??
                        "Unassigned"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase text-muted-foreground">Due</dt>
                    <dd className="tabular-nums">{action.due_date ? formatDateTime(action.due_date) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase text-muted-foreground">Source</dt>
                    <dd className="capitalize">{action.source_type.replace(/_/g, " ")}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase text-muted-foreground">Created</dt>
                    <dd className="tabular-nums">{formatDateTime(action.created_at)}</dd>
                  </div>
                </dl>

                {isHr ? (
                  <section className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["new", "under_review", "approval_required"].includes(action.status) && !action.approval_required ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingAction("request_approval")}
                          disabled={runWorkflow.isPending}
                        >
                          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                          Request approval
                        </Button>
                      ) : null}
                      {canStartWork ? (
                        <Button
                          size="sm"
                          onClick={() => runWorkflow.mutate({ action: "start", action_id: action.id })}
                          disabled={runWorkflow.isPending}
                        >
                          <Gauge className="mr-2 h-4 w-4" aria-hidden="true" />
                          Start work
                        </Button>
                      ) : null}
                      {action.status === "approval_required" ? (
                        <p className="text-xs text-muted-foreground">
                          This action is waiting on the Founder/CEO. HR cannot progress it until a decision is recorded.
                        </p>
                      ) : null}
                      {isHr && ["in_progress", "approved", "under_review"].includes(action.status) ? (
                        <Button size="sm" variant="outline" onClick={() => setResolveOpen(true)} disabled={runWorkflow.isPending}>
                          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                          Resolve or fail
                        </Button>
                      ) : null}
                      {isHr && !["resolved", "failed", "dismissed"].includes(action.status) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => runWorkflow.mutate({ action: "dismiss", action_id: action.id })}
                          disabled={runWorkflow.isPending}
                        >
                          Dismiss
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Reassign owner</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={assignTo || action.assigned_to || ""}
                          onChange={(event) => setAssignTo(event.target.value)}
                          className="h-10 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">Unassigned</option>
                          {hrProfiles.map((profileRow) => (
                            <option key={profileRow.user_id} value={profileRow.user_id}>
                              {profileRow.full_name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!assignTo || runWorkflow.isPending}
                          onClick={() => runWorkflow.mutate({ action: "assign", action_id: action.id, assigned_to: assignTo })}
                        >
                          Assign
                        </Button>
                      </div>
                    </div>
                  </section>
                ) : null}

                {isFounder && action.status === "approval_required" && pendingApproval ? (
                  <section className="rounded-lg border border-warning/25 bg-warning-soft p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-warning">
                      Your decision is required
                    </h3>
                    <p className="mt-2 text-sm text-foreground">
                      Approving releases the action to HR. Rejecting returns it with your notes.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => setPendingAction("approve")}
                        disabled={runWorkflow.isPending}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingAction("reject")}
                        disabled={runWorkflow.isPending}
                      >
                        <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                        Reject
                      </Button>
                    </div>
                  </section>
                ) : null}

                {action.resolution_notes ? (
                  <section className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Resolution evidence
                    </h3>
                    <p className="mt-2 text-sm">{action.resolution_notes}</p>
                  </section>
                ) : null}

                {isHr || isFounder ? (
                  <section className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add comment</h3>
                    <Textarea
                      rows={2}
                      className="mt-2"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Context for the workflow timeline"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={!comment.trim() || runWorkflow.isPending}
                      onClick={() => runWorkflow.mutate({ action: "comment", action_id: action.id, comment })}
                    >
                      <MessageSquarePlus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      Add comment
                    </Button>
                  </section>
                ) : null}

                <section className="rounded-lg border border-border bg-card">
                  <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Workflow timeline
                  </h3>
                  {(actionQuery.data?.events ?? []).length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground">No workflow events recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {[...(actionQuery.data?.events ?? [])].reverse().map((event) => (
                        <li key={event.id} className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm capitalize text-foreground">{event.event_type.replace(/_/g, " ")}</p>
                            {event.previous_state && event.new_state && event.previous_state !== event.new_state ? (
                              <ToneBadge tone="workflow">
                                {event.previous_state} → {event.new_state}
                              </ToneBadge>
                            ) : null}
                          </div>
                          {(event.metadata as { comment?: string })?.comment ? (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {(event.metadata as { comment?: string }).comment}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(event.created_at)}
                            {(event.metadata as { author?: string })?.author
                              ? ` · ${(event.metadata as { author?: string }).author}`
                              : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-card">
                  <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Audit history
                  </h3>
                  {auditQuery.isLoading ? (
                    <div className="p-4">
                      <TableSkeleton rows={3} columns={2} />
                    </div>
                  ) : (auditQuery.data ?? []).length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground">No audit entries recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {auditQuery.data!.map((entry) => (
                        <li key={entry.id} className="px-4 py-3">
                          <p className="text-sm capitalize text-foreground">{entry.action.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(entry.created_at)}
                            {entry.actor_email ? ` · ${entry.actor_email}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={pendingAction === "request_approval"}
        onOpenChange={(open) => (!open ? setPendingAction(null) : undefined)}
        title="Request Founder/CEO approval?"
        description="The action moves to Approval Required and cannot progress until the Founder/CEO records a decision. The approver is notified immediately."
        confirmLabel="Request approval"
        busy={runWorkflow.isPending}
        onConfirm={() => action && runWorkflow.mutate({ action: "request_approval", action_id: action.id })}
      />

      <ConfirmDialog
        open={pendingAction === "approve"}
        onOpenChange={(open) => (!open ? setPendingAction(null) : undefined)}
        title="Approve this action?"
        description="Approving releases the action to HR and records your decision with a timestamp in the audit history."
        confirmLabel="Approve action"
        busy={runWorkflow.isPending}
        onConfirm={() =>
          pendingApproval && runWorkflow.mutate({ action: "decide", approval_id: pendingApproval.id, decision: "approved" })
        }
      />

      <ConfirmDialog
        open={pendingAction === "reject"}
        onOpenChange={(open) => (!open ? setPendingAction(null) : undefined)}
        title="Reject this action?"
        description="Rejecting returns the action to HR with your notes. The decision is recorded and the requester is notified."
        confirmLabel="Reject action"
        destructive
        busy={runWorkflow.isPending}
        onConfirm={() =>
          pendingApproval &&
          runWorkflow.mutate({
            action: "decide",
            approval_id: pendingApproval.id,
            decision: "rejected",
            decision_notes: resolutionNotes || "Rejected by the Founder/CEO.",
          })
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="reject-notes" className="text-xs font-medium text-muted-foreground">
            Decision notes
          </Label>
          <Textarea
            id="reject-notes"
            rows={2}
            value={resolutionNotes}
            onChange={(event) => setResolutionNotes(event.target.value)}
            placeholder="Explain the decision for the audit record"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title="Close out this action"
        description="Record the resolution evidence, or mark the action as failed so the outcome is visible in reporting."
        confirmLabel="Resolve action"
        busy={runWorkflow.isPending}
        onConfirm={() =>
          action &&
          runWorkflow.mutate({ action: "resolve", action_id: action.id, resolution_notes: resolutionNotes })
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="resolution-notes" className="text-xs font-medium text-muted-foreground">
              Resolution evidence
            </Label>
            <Textarea
              id="resolution-notes"
              rows={3}
              value={resolutionNotes}
              onChange={(event) => setResolutionNotes(event.target.value)}
              placeholder="What was done, and what changed as a result?"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={runWorkflow.isPending}
            onClick={() =>
              action && runWorkflow.mutate({ action: "fail", action_id: action.id, resolution_notes: resolutionNotes })
            }
          >
            <Send className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Mark as failed instead
          </Button>
        </div>
      </ConfirmDialog>
    </>
  );
}
