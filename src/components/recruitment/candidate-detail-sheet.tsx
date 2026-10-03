import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, GraduationCap, Loader2, UserCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { supabase } from "@/lib/db";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useAuth } from "@/providers/auth-provider";
import { formatDate, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import {
  CANDIDATE_STAGE_LABELS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_TONE,
  type Candidate,
  type CandidateStage,
  type Internship,
  type Interview,
  type Requisition,
} from "@/lib/types";

/** Mirrors the backend transition map so the UI only offers valid next steps. */
const ALLOWED_TRANSITIONS: Record<CandidateStage, CandidateStage[]> = {
  applied: ["screening"],
  screening: ["interview"],
  interview: ["internship", "full_time_offer"],
  internship: ["full_time_offer"],
  full_time_offer: ["hired"],
  hired: [],
};

const STAGE_TONE: Record<CandidateStage, "info" | "workflow" | "insight" | "warning" | "success" | "primary"> = {
  applied: "info",
  screening: "workflow",
  interview: "insight",
  internship: "warning",
  full_time_offer: "primary",
  hired: "success",
};

interface CandidateDetailSheetProps {
  candidateId: string | null;
  onClose: () => void;
}

export function CandidateDetailSheet({ candidateId, onClose }: CandidateDetailSheetProps) {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const queryClient = useQueryClient();
  const { openEmployee360 } = useEmployee360();

  const [pendingStage, setPendingStage] = useState<CandidateStage | null>(null);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewType, setInterviewType] = useState("technical");
  const [interviewAt, setInterviewAt] = useState("");
  const [notes, setNotes] = useState("");
  const [internStart, setInternStart] = useState(new Date().toISOString().slice(0, 10));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["candidate-detail", candidateId],
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const [candidate, interviews, internships] = await Promise.all([
        supabase.from("hr_candidates").select("*, hr_job_requisitions(id, job_title, department_id, hr_departments(name))").eq("id", candidateId).maybeSingle(),
        supabase.from("hr_interviews").select("*").eq("candidate_id", candidateId).order("scheduled_at", { ascending: false }),
        supabase.from("hr_internships").select("*").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
      ]);
      if (candidate.error) throw new Error(candidate.error.message);
      return {
        candidate: candidate.data as (Candidate & { hr_job_requisitions: Requisition & { hr_departments: { name: string } | null } | null }) | null,
        interviews: (interviews.data ?? []) as Interview[],
        internships: (internships.data ?? []) as Internship[],
      };
    },
  });

  const auditTrail = useQuery({
    queryKey: ["candidate-audit", candidateId],
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("hr_audit_log")
        .select("*")
        .eq("entity_type", "candidate")
        .eq("entity_id", candidateId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return rows ?? [];
    },
  });

  const candidate = data?.candidate ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["candidate-detail", candidateId] });
    void queryClient.invalidateQueries({ queryKey: ["candidate-audit", candidateId] });
    void queryClient.invalidateQueries({ queryKey: ["recruitment-candidates"] });
    void queryClient.invalidateQueries({ queryKey: ["recruitment-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["employees"] });
    void queryClient.invalidateQueries({ queryKey: ["workforce-employees"] });
  };

  const transition = useMutation({
    mutationFn: async ({ stage, start }: { stage: CandidateStage; start?: string }) => {
      const { data: result, error } = await supabase.functions.invoke<{
        ok: boolean;
        message?: string;
        linked_employee_id?: string;
        already_applied?: boolean;
      }>("candidate-transition", {
        body: { action: "transition", candidate_id: candidateId, to_stage: stage, start_date: start, notes },
        headers: { "Content-Type": "application/json" },
      });
      if (error) throw new Error(error.message);
      if (!result?.ok) throw new Error(result?.message ?? "The transition was rejected.");
      return result;
    },
    onSuccess: (result, variables) => {
      setPendingStage(null);
      setNotes("");
      toast.success(
        result.already_applied
          ? "No change was needed — the candidate was already in that stage."
          : variables.stage === "internship"
            ? "Internship started. An intern employee record was created or linked."
            : variables.stage === "hired"
              ? "Candidate hired. The linked employee record was updated to full-time."
              : `Moved to ${CANDIDATE_STAGE_LABELS[variables.stage]}.`,
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const scheduleInterview = useMutation({
    mutationFn: async () => {
      const { data: result, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>(
        "candidate-transition",
        {
          body: {
            action: "schedule_interview",
            candidate_id: candidateId,
            interview_type: interviewType,
            scheduled_at: interviewAt ? new Date(interviewAt).toISOString() : null,
          },
          headers: { "Content-Type": "application/json" },
        },
      );
      if (error) throw new Error(error.message);
      if (!result?.ok) throw new Error(result?.message ?? "The interview could not be scheduled.");
      return result;
    },
    onSuccess: () => {
      toast.success("Interview scheduled.");
      setInterviewOpen(false);
      setInterviewAt("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const completeInterview = useMutation({
    mutationFn: async (interviewId: string) => {
      const { data: result, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>(
        "candidate-transition",
        {
          body: {
            action: "complete_interview",
            candidate_id: candidateId,
            interview_id: interviewId,
            rating: 4,
            feedback: "Structured interview completed and recorded.",
            recommendation: "hire",
          },
          headers: { "Content-Type": "application/json" },
        },
      );
      if (error) throw new Error(error.message);
      if (!result?.ok) throw new Error(result?.message ?? "The interview could not be completed.");
      return result;
    },
    onSuccess: () => {
      toast.success("Interview marked complete.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const internship = data?.internships[0] ?? null;
  const nextStages = useMemo(
    () => (candidate ? ALLOWED_TRANSITIONS[candidate.current_stage] ?? [] : []),
    [candidate],
  );

  return (
    <>
      <Sheet open={Boolean(candidateId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto p-0 sm:max-w-2xl">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading candidate…
            </div>
          ) : isError ? (
            <div className="p-6">
              <ErrorState onRetry={() => void refetch()} />
            </div>
          ) : !candidate ? (
            <div className="p-6">
              <EmptyState title="Candidate not found" description="This record may have been removed." />
            </div>
          ) : (
            <>
              <SheetHeader className="border-b border-border px-6 py-5 text-left">
                <SheetTitle className="text-lg">{candidate.full_name}</SheetTitle>
                <SheetDescription>
                  {candidate.hr_job_requisitions?.job_title ?? "No requisition"} ·{" "}
                  {candidate.hr_job_requisitions?.hr_departments?.name ?? "Unassigned"}
                </SheetDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ToneBadge tone={STAGE_TONE[candidate.current_stage]}>
                    {CANDIDATE_STAGE_LABELS[candidate.current_stage]}
                  </ToneBadge>
                  <StatusBadge value={candidate.status} labels={CANDIDATE_STATUS_LABELS} tones={CANDIDATE_STATUS_TONE} />
                  {candidate.rating ? <ToneBadge tone="neutral">Rating {candidate.rating}/5</ToneBadge> : null}
                </div>
              </SheetHeader>

              <div className="space-y-4 px-6 py-5">
                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidate</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-[11px] uppercase text-muted-foreground">Email</dt>
                      <dd className="break-all">{candidate.email ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase text-muted-foreground">Phone</dt>
                      <dd>{candidate.phone ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase text-muted-foreground">Source</dt>
                      <dd>{candidate.source ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase text-muted-foreground">Applied</dt>
                      <dd>{formatDate(candidate.applied_date)}</dd>
                    </div>
                  </dl>
                </section>

                {isHr ? (
                  <section className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Move to next stage
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every transition is validated on the backend, confirmed here, and recorded in the audit history.
                    </p>
                    {nextStages.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        This candidate has completed the pipeline. Hire conversion preserves the same employee record.
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {nextStages.map((stage) => (
                          <Button
                            key={stage}
                            size="sm"
                            variant={stage === "hired" ? "default" : "outline"}
                            onClick={() => setPendingStage(stage)}
                          >
                            {stage === "internship" ? (
                              <GraduationCap className="mr-2 h-4 w-4" aria-hidden="true" />
                            ) : stage === "hired" ? (
                              <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                            ) : null}
                            Move to {CANDIDATE_STAGE_LABELS[stage]}
                          </Button>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 space-y-1.5">
                      <Label htmlFor="transition-notes" className="text-xs font-medium text-muted-foreground">
                        Notes (optional)
                      </Label>
                      <Textarea
                        id="transition-notes"
                        rows={2}
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Context recorded with the workflow event"
                      />
                    </div>
                  </section>
                ) : null}

                <section className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Interview timeline
                    </h3>
                    {isHr ? (
                      <Button size="sm" variant="outline" onClick={() => setInterviewOpen(true)}>
                        <CalendarClock className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        Schedule
                      </Button>
                    ) : null}
                  </div>
                  {(data?.interviews ?? []).length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground">No interviews scheduled yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {data!.interviews.map((interview) => (
                        <li key={interview.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm capitalize text-foreground">{interview.interview_type} interview</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(interview.scheduled_at)}
                              {interview.completed_at ? ` · completed ${formatDateTime(interview.completed_at)}` : ""}
                              {interview.rating ? ` · rating ${interview.rating}/5` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <ToneBadge tone={interview.status === "completed" ? "success" : "workflow"}>
                              {interview.status}
                            </ToneBadge>
                            {isHr && interview.status !== "completed" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => completeInterview.mutate(interview.id)}
                                disabled={completeInterview.isPending}
                              >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                                Complete
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {internship ? (
                  <section className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internship
                    </h3>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-[11px] uppercase text-muted-foreground">Start</dt>
                        <dd>{formatDate(internship.start_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase text-muted-foreground">Planned end</dt>
                        <dd>{formatDate(internship.planned_end_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase text-muted-foreground">Status</dt>
                        <dd className="capitalize">{internship.status}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase text-muted-foreground">Conversion</dt>
                        <dd className="capitalize">{internship.conversion_decision ?? "pending"}</dd>
                      </div>
                    </dl>
                    {internship.evaluation ? (
                      <p className="mt-3 text-sm text-muted-foreground">{internship.evaluation}</p>
                    ) : null}
                    {internship.employee_id ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => internship.employee_id && openEmployee360(internship.employee_id)}
                      >
                        Open linked employee 360°
                      </Button>
                    ) : null}
                  </section>
                ) : null}

                {candidate.linked_employee_id ? (
                  <section className="rounded-lg border border-success/25 bg-success-soft p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-success">Linked employee</h3>
                    <p className="mt-1 text-sm text-foreground">
                      This candidate is linked to a single employee record. Hiring updates that same record — no
                      duplicate employee is created.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => openEmployee360(candidate.linked_employee_id!)}
                    >
                      Open employee 360°
                    </Button>
                  </section>
                ) : null}

                <section className="rounded-lg border border-border bg-card">
                  <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recruitment history
                  </h3>
                  {auditTrail.isLoading ? (
                    <div className="p-4">
                      <TableSkeleton rows={4} columns={2} />
                    </div>
                  ) : (auditTrail.data ?? []).length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground">No history recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {auditTrail.data!.map((entry) => (
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
        open={Boolean(pendingStage)}
        onOpenChange={(open) => (!open ? setPendingStage(null) : undefined)}
        title={
          pendingStage === "hired"
            ? `Hire ${candidate?.full_name ?? "candidate"}?`
            : pendingStage === "internship"
              ? `Start internship for ${candidate?.full_name ?? "candidate"}?`
              : `Move to ${pendingStage ? CANDIDATE_STAGE_LABELS[pendingStage] : ""}?`
        }
        description={
          pendingStage === "internship" ? (
            <>
              An intern employee record will be created or linked, and the candidate, internship and employee will be
              connected. Hiring later updates that same employee record.
            </>
          ) : pendingStage === "hired" ? (
            <>
              The linked employee record will be updated to full-time and the internship converted. Interview, internship,
              offer and conversion history is preserved, and no duplicate employee is created.
            </>
          ) : (
            <>The stage change is validated on the backend, written to the audit log and broadcast to every open view.</>
          )
        }
        confirmLabel={pendingStage === "hired" ? "Confirm hire" : "Confirm transition"}
        busy={transition.isPending}
        onConfirm={() =>
          pendingStage &&
          transition.mutate({
            stage: pendingStage,
            start: pendingStage === "internship" ? internStart : undefined,
          })
        }
      >
        {pendingStage === "internship" ? (
          <div className="space-y-1.5">
            <Label htmlFor="intern-start" className="text-xs font-medium text-muted-foreground">
              Internship start date
            </Label>
            <Input
              id="intern-start"
              type="date"
              value={internStart}
              onChange={(event) => setInternStart(event.target.value)}
            />
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={interviewOpen}
        onOpenChange={setInterviewOpen}
        title="Schedule an interview"
        description="The interview is added to the candidate timeline with the selected type and time."
        confirmLabel="Schedule interview"
        busy={scheduleInterview.isPending}
        onConfirm={() => scheduleInterview.mutate()}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Interview type</Label>
            <select
              value={interviewType}
              onChange={(event) => setInterviewType(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {["screening", "technical", "managerial", "hr", "panel", "final"].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Scheduled at</Label>
            <Input type="datetime-local" value={interviewAt} onChange={(event) => setInterviewAt(event.target.value)} />
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}
