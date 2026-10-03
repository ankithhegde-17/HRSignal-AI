import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Layers, Loader2, Plus, UserPlus, Users } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { CardSkeleton, EmptyState, QueryState, TableSkeleton } from "@/components/shared/states";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ClearFiltersButton, FilterBar, SearchInput, SelectFilter } from "@/components/shared/filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CandidateDetailSheet } from "@/components/recruitment/candidate-detail-sheet";
import { supabase } from "@/lib/db";
import { useDepartmentOptions } from "@/hooks/use-lookups";
import { useAuth } from "@/providers/auth-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import {
  CANDIDATE_STAGE_LABELS,
  CANDIDATE_STAGE_OPTIONS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_TONE,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_OPTIONS,
  REQUISITION_STATUS_LABELS,
  REQUISITION_STATUS_OPTIONS,
  REQUISITION_STATUS_TONE,
  type Candidate,
  type CandidateStage,
  type EmploymentType,
  type Requisition,
  type RequisitionStatus,
} from "@/lib/types";

const STAGE_ACCENT: Record<CandidateStage, string> = {
  applied: "border-t-info",
  screening: "border-t-workflow",
  interview: "border-t-insight",
  internship: "border-t-warning",
  full_time_offer: "border-t-primary",
  hired: "border-t-success",
};

export default function RecruitmentPage() {
  const { profile } = useAuth();
  const isHr = profile?.role === "hr";
  const { options: departmentOptions } = useDepartmentOptions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [requisition, setRequisition] = useState("all");
  const [stage, setStage] = useState("all");
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [requisitionFormOpen, setRequisitionFormOpen] = useState(false);
  const [editingRequisition, setEditingRequisition] = useState<Requisition | null>(null);
  const [candidateFormOpen, setCandidateFormOpen] = useState(false);

  useRealtimeRefresh(["hr_candidates", "hr_job_requisitions"], [["recruitment-candidates"], ["recruitment-summary"]]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["recruitment-candidates"],
    queryFn: async () => {
      const [candidates, requisitions] = await Promise.all([
        supabase.from("hr_candidates").select("*").order("applied_date", { ascending: false }).limit(1000),
        supabase.from("hr_job_requisitions").select("*").order("open_date", { ascending: false }).limit(200),
      ]);
      if (candidates.error) throw new Error(candidates.error.message);
      if (requisitions.error) throw new Error(requisitions.error.message);
      return {
        candidates: (candidates.data ?? []) as Candidate[],
        requisitions: (requisitions.data ?? []) as Requisition[],
      };
    },
  });

  useEffect(() => {
    const id = searchParams.get("candidate");
    if (!id) return;
    setCandidateId(id);
    const next = new URLSearchParams(searchParams);
    next.delete("candidate");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const requisitionById = useMemo(
    () => new Map((data?.requisitions ?? []).map((item) => [item.id, item])),
    [data?.requisitions],
  );

  const departmentName = useMemo(() => {
    const map = new Map(departmentOptions.map((option) => [option.value, option.label]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [departmentOptions]);

  const filteredRequisitions = useMemo(
    () => (data?.requisitions ?? []).filter((item) => department === "all" || item.department_id === department),
    [data?.requisitions, department],
  );

  const filteredCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.candidates ?? []).filter((candidate) => {
      const req = candidate.requisition_id ? requisitionById.get(candidate.requisition_id) : null;
      if (department !== "all" && req?.department_id !== department) return false;
      if (requisition !== "all" && candidate.requisition_id !== requisition) return false;
      if (stage !== "all" && candidate.current_stage !== stage) return false;
      if (!term) return true;
      return candidate.full_name.toLowerCase().includes(term) || (candidate.email ?? "").toLowerCase().includes(term);
    });
  }, [data?.candidates, department, requisition, requisitionById, search, stage]);

  const summary = useMemo(() => {
    const openRequisitions = (data?.requisitions ?? []).filter((item) => item.status === "open");
    const activeCandidates = (data?.candidates ?? []).filter((candidate) => candidate.status === "active");
    return {
      openRequisitions: openRequisitions.length,
      openings: openRequisitions.reduce((total, item) => total + Number(item.openings ?? 0), 0),
      activeCandidates: activeCandidates.length,
      inInterview: activeCandidates.filter((candidate) => candidate.current_stage === "interview").length,
      hired: (data?.candidates ?? []).filter((candidate) => candidate.current_stage === "hired").length,
    };
  }, [data]);

  const columns: Column<Candidate>[] = [
    {
      key: "full_name",
      header: "Candidate",
      sortValue: (row) => row.full_name,
      cell: (row) => (
        <button type="button" className="min-w-0 text-left hover:text-primary" onClick={() => setCandidateId(row.id)}>
          <p className="truncate font-medium">{row.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.email ?? "—"}</p>
        </button>
      ),
    },
    {
      key: "requisition",
      header: "Requisition",
      sortValue: (row) => (row.requisition_id ? requisitionById.get(row.requisition_id)?.job_title ?? "" : ""),
      cell: (row) => (
        <span className="text-sm">
          {row.requisition_id ? requisitionById.get(row.requisition_id)?.job_title ?? "—" : "—"}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "stage",
      header: "Stage",
      sortValue: (row) => row.current_stage,
      cell: (row) => <ToneBadge tone="workflow">{CANDIDATE_STAGE_LABELS[row.current_stage]}</ToneBadge>,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => <StatusBadge value={row.status} labels={CANDIDATE_STATUS_LABELS} tones={CANDIDATE_STATUS_TONE} />,
    },
    {
      key: "applied_date",
      header: "Applied",
      sortValue: (row) => row.applied_date,
      cell: (row) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.applied_date)}</span>,
      hideBelow: "md",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => setCandidateId(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  const requisitionColumns: Column<Requisition>[] = [
    {
      key: "job_title",
      header: "Requisition",
      sortValue: (row) => row.job_title,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.job_title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {departmentName(row.department_id)} · {EMPLOYMENT_TYPE_LABELS[row.employment_type]}
          </p>
        </div>
      ),
    },
    { key: "openings", header: "Openings", align: "right", sortValue: (row) => row.openings, cell: (row) => <span className="tabular-nums">{row.openings}</span> },
    {
      key: "pipeline",
      header: "In pipeline",
      align: "right",
      sortValue: (row) =>
        (data?.candidates ?? []).filter(
          (candidate) => candidate.requisition_id === row.id && candidate.status === "active" && candidate.current_stage !== "hired",
        ).length,
      cell: (row) => (
        <span className="tabular-nums">
          {
            (data?.candidates ?? []).filter(
              (candidate) => candidate.requisition_id === row.id && candidate.status === "active" && candidate.current_stage !== "hired",
            ).length
          }
        </span>
      ),
      hideBelow: "sm",
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => <StatusBadge value={row.status} labels={REQUISITION_STATUS_LABELS} tones={REQUISITION_STATUS_TONE} />,
    },
    {
      key: "target_close_date",
      header: "Target close",
      sortValue: (row) => row.target_close_date ?? "",
      cell: (row) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.target_close_date)}</span>,
      hideBelow: "md",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        isHr ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingRequisition(row);
              setRequisitionFormOpen(true);
            }}
          >
            Edit
          </Button>
        ) : null,
    },
  ];

  const hasFilters = Boolean(search) || department !== "all" || requisition !== "all" || stage !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recruitment"
        description="Requisitions, candidate pipeline and internship-to-hire conversion."
        breadcrumbs={[{ label: "Recruitment" }]}
        actions={
          isHr ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingRequisition(null);
                  setRequisitionFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New requisition
              </Button>
              <Button size="sm" onClick={() => setCandidateFormOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add candidate
              </Button>
            </>
          ) : null
        }
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        loadingFallback={
          <div className="space-y-5">
            <CardSkeleton count={4} />
          </div>
        }
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Open requisitions" value={summary.openRequisitions} icon={Briefcase} tone="workflow" hint={`${summary.openings} openings`} />
          <KpiCard label="Active candidates" value={summary.activeCandidates} icon={Users} tone="primary" hint="Not rejected or withdrawn" />
          <KpiCard label="In interview" value={summary.inInterview} icon={Layers} tone="insight" hint="Interview stage" />
          <KpiCard label="Hired" value={summary.hired} icon={UserPlus} tone="success" hint="Converted to employees" />
        </section>

        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search candidate name or email…" />
          <SelectFilter label="Department" value={department} onChange={setDepartment} options={departmentOptions} />
          <SelectFilter
            label="Requisition"
            value={requisition}
            onChange={setRequisition}
            options={filteredRequisitions.map((item) => ({ value: item.id, label: item.job_title }))}
            allLabel="All requisitions"
          />
          <SelectFilter
            label="Stage"
            value={stage}
            onChange={setStage}
            options={CANDIDATE_STAGE_OPTIONS.map((option) => ({ value: option, label: CANDIDATE_STAGE_LABELS[option] }))}
          />
          <ClearFiltersButton
            visible={hasFilters}
            onClick={() => {
              setSearch("");
              setDepartment("all");
              setRequisition("all");
              setStage("all");
            }}
          />
        </FilterBar>

        <Tabs defaultValue="pipeline">
          <TabsList className="flex-wrap">
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="candidates">Candidate table</TabsTrigger>
            <TabsTrigger value="requisitions">Requisitions</TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="space-y-4">
            <SectionHeader
              title="Candidate pipeline"
              description="Select a candidate to review interviews, internship details and move them through validated stages."
            />
            {filteredCandidates.length === 0 ? (
              <EmptyState title="No candidates match" description="Adjust the filters or add a candidate." />
            ) : (
              <div className="hr-scroll-area -mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
                {CANDIDATE_STAGE_OPTIONS.map((stageOption) => {
                  const inStage = filteredCandidates.filter((candidate) => candidate.current_stage === stageOption);
                  return (
                    <section
                      key={stageOption}
                      className={`flex w-[16rem] shrink-0 flex-col rounded-lg border border-t-4 border-border bg-card shadow-card ${STAGE_ACCENT[stageOption]}`}
                    >
                      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {CANDIDATE_STAGE_LABELS[stageOption]}
                        </h3>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                          {inStage.length}
                        </span>
                      </header>
                      <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto p-3">
                        {inStage.length === 0 ? (
                          <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                            No candidates
                          </li>
                        ) : (
                          inStage.map((candidate) => (
                            <li key={candidate.id}>
                              <button
                                type="button"
                                onClick={() => setCandidateId(candidate.id)}
                                className="w-full rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:shadow-raised"
                              >
                                <p className="truncate text-sm font-medium text-foreground">{candidate.full_name}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {candidate.requisition_id ? requisitionById.get(candidate.requisition_id)?.job_title ?? "—" : "—"}
                                </p>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <StatusBadge
                                    value={candidate.status}
                                    labels={CANDIDATE_STATUS_LABELS}
                                    tones={CANDIDATE_STATUS_TONE}
                                  />
                                  <span className="text-[11px] tabular-nums text-muted-foreground">
                                    {formatDate(candidate.applied_date)}
                                  </span>
                                </div>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="candidates" className="space-y-4">
            <DataTable
              columns={columns}
              rows={filteredCandidates}
              getRowId={(row) => row.id}
              initialSort={{ key: "applied_date", direction: "desc" }}
              pageSize={15}
              caption="Candidate table"
              emptyState={<EmptyState title="No candidates" description="Add a candidate to start the pipeline." />}
            />
          </TabsContent>

          <TabsContent value="requisitions" className="space-y-4">
            <DataTable
              columns={requisitionColumns}
              rows={filteredRequisitions}
              getRowId={(row) => row.id}
              initialSort={{ key: "job_title", direction: "asc" }}
              pageSize={10}
              caption="Job requisitions"
              emptyState={<EmptyState title="No requisitions" description="Create a requisition to open a role." />}
            />
          </TabsContent>
        </Tabs>
      </QueryState>

      <RequisitionFormDialog
        open={requisitionFormOpen}
        onOpenChange={setRequisitionFormOpen}
        requisition={editingRequisition}
        onSaved={() => {
          toast.success(editingRequisition ? "Requisition updated." : "Requisition created.");
          setEditingRequisition(null);
          void queryClient.invalidateQueries({ queryKey: ["recruitment-candidates"] });
        }}
      />

      <CandidateFormDialog
        open={candidateFormOpen}
        onOpenChange={setCandidateFormOpen}
        requisitions={(data?.requisitions ?? []).filter((item) => item.status !== "closed")}
        departmentName={departmentName}
        onSaved={() => {
          toast.success("Candidate added to the pipeline.");
          void queryClient.invalidateQueries({ queryKey: ["recruitment-candidates"] });
          void queryClient.invalidateQueries({ queryKey: ["recruitment-summary"] });
        }}
      />

      <CandidateDetailSheet candidateId={candidateId} onClose={() => setCandidateId(null)} />
    </div>
  );
}

function RequisitionFormDialog({
  open,
  onOpenChange,
  requisition,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisition: Requisition | null;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const { options: departmentOptions } = useDepartmentOptions();
  const [jobTitle, setJobTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full-time");
  const [openings, setOpenings] = useState("1");
  const [status, setStatus] = useState<RequisitionStatus>("open");
  const [targetClose, setTargetClose] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setJobTitle(requisition?.job_title ?? "");
    setDepartmentId(requisition?.department_id ?? "");
    setEmploymentType(requisition?.employment_type ?? "full-time");
    setOpenings(String(requisition?.openings ?? 1));
    setStatus(requisition?.status ?? "open");
    setTargetClose(requisition?.target_close_date ?? "");
    setDescription(requisition?.description ?? "");
    setError(null);
  }, [open, requisition]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!jobTitle.trim()) {
      setError("Job title is required.");
      return;
    }
    if (!departmentId) {
      setError("Select a department — recruitment always references a department.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      job_title: jobTitle.trim(),
      department_id: departmentId,
      employment_type: employmentType,
      openings: Math.max(1, Number(openings) || 1),
      status,
      target_close_date: targetClose || null,
      description: description.trim() || null,
      recruiter_id: profile?.user_id ?? null,
      open_date: requisition?.open_date ?? new Date().toISOString().slice(0, 10),
      close_date: status === "closed" ? new Date().toISOString().slice(0, 10) : null,
    };

    try {
      if (requisition) {
        const { error: updateError } = await supabase.from("hr_job_requisitions").update(payload).eq("id", requisition.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from("hr_job_requisitions").insert(payload);
        if (insertError) throw insertError;
      }
      await supabase.from("hr_audit_log").insert({
        actor_id: profile?.user_id ?? null,
        actor_email: profile?.email ?? null,
        entity_type: "requisition",
        entity_id: requisition?.id ?? null,
        action: requisition ? "requisition_updated" : "requisition_created",
        after_json: payload,
      });
      onSaved();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{requisition ? "Edit requisition" : "New requisition"}</DialogTitle>
          <DialogDescription>
            Department → job requisition → candidate. Candidates always belong to a requisition.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Job title *</Label>
            <Input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} disabled={saving} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Department *</Label>
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select department</option>
                {departmentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Employment type</Label>
              <select
                value={employmentType}
                onChange={(event) => setEmploymentType(event.target.value as EmploymentType)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {EMPLOYMENT_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Openings</Label>
              <Input type="number" min={1} value={openings} onChange={(event) => setOpenings(event.target.value)} disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as RequisitionStatus)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {REQUISITION_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {REQUISITION_STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Target close date</Label>
            <Input type="date" value={targetClose} onChange={(event) => setTargetClose(event.target.value)} disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Description</Label>
            <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} />
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {requisition ? "Save changes" : "Create requisition"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CandidateFormDialog({
  open,
  onOpenChange,
  requisitions,
  departmentName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisitions: Requisition[];
  departmentName: (id: string | null) => string;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [requisitionId, setRequisitionId] = useState("");
  const [source, setSource] = useState("Referral");
  const [rating, setRating] = useState("3");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName("");
    setEmail("");
    setPhone("");
    setRequisitionId(requisitions[0]?.id ?? "");
    setSource("Referral");
    setRating("3");
    setNotes("");
    setError(null);
  }, [open, requisitions]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fullName.trim()) {
      setError("Candidate name is required.");
      return;
    }
    if (!requisitionId) {
      setError("Select a requisition — candidates are always linked to a requisition.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      full_name: fullName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      requisition_id: requisitionId,
      source,
      rating: rating ? Number(rating) : null,
      notes: notes.trim() || null,
      current_stage: "applied",
      status: "active",
      applied_date: new Date().toISOString().slice(0, 10),
      recruiter_id: profile?.user_id ?? null,
    };

    try {
      const { data: created, error: insertError } = await supabase
        .from("hr_candidates")
        .insert(payload)
        .select("id")
        .single();
      if (insertError) throw insertError;
      await supabase.from("hr_audit_log").insert({
        actor_id: profile?.user_id ?? null,
        actor_email: profile?.email ?? null,
        entity_type: "candidate",
        entity_id: created.id,
        action: "candidate_created",
        after_json: payload,
      });
      onSaved();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>New candidates start in the Applied stage.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Full name *</Label>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={saving} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Phone</Label>
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} disabled={saving} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Requisition *</Label>
            <select
              value={requisitionId}
              onChange={(event) => setRequisitionId(event.target.value)}
              disabled={saving}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select requisition</option>
              {requisitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.job_title} · {departmentName(item.department_id)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Source</Label>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {["Referral", "LinkedIn", "Career Site", "Agency", "Campus", "Other"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Rating (1–5)</Label>
              <select
                value={rating}
                onChange={(event) => setRating(event.target.value)}
                disabled={saving}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} />
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Add candidate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
