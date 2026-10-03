import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { SearchInput, SelectFilter, FilterBar, ClearFiltersButton } from "@/components/shared/filter-bar";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useTeamOptions } from "@/hooks/use-lookups";
import { useAuth } from "@/providers/auth-provider";
import { initials } from "@/lib/format";
import { toast } from "sonner";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYEE_STATUS_TONE,
  WORK_MODE_LABELS,
  type Employee,
  type Team,
} from "@/lib/types";

/* ---------------------------------------------------------------- form dialog */

interface TeamFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departmentId: string | null;
  team: Team | null;
  onSaved: () => void;
}

export function TeamFormDialog({ open, onOpenChange, departmentId, team, onSaved }: TeamFormDialogProps) {
  const { profile } = useAuth();
  const [name, setName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? "");
    setTeamCode(team?.team_code ?? "");
    setDescription(team?.description ?? "");
    setCapacity(team?.capacity != null ? String(team.capacity) : "");
    setError(null);
  }, [open, team]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !teamCode.trim()) {
      setError("Team name and code are required.");
      return;
    }
    if (team && !departmentId) {
      setError("Department context is missing.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok: boolean; message?: string }>(
      "team-management",
      {
        body: team
          ? {
              action: "update",
              team_id: team.id,
              name,
              team_code: teamCode,
              description,
              capacity: capacity === "" ? null : Number(capacity),
            }
          : {
              action: "create",
              department_id: departmentId,
              name,
              team_code: teamCode,
              description,
              capacity: capacity === "" ? null : Number(capacity),
            },
        headers: { "Content-Type": "application/json" },
      },
    );
    setSaving(false);
    if (invokeError || !data?.ok) {
      setError((data?.message ?? invokeError?.message) || "The team could not be saved.");
      return;
    }
    toast.success(team ? "Team updated." : "Team created.");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{team ? "Edit team" : "Create team"}</DialogTitle>
          <DialogDescription>Teams sit between departments and employees. A team belongs to exactly one department.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Team name *</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Team code *</Label>
              <Input value={teamCode} onChange={(event) => setTeamCode(event.target.value)} placeholder="ENG-QA" disabled={saving} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Capacity</Label>
            <Input type="number" min={0} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={saving} />
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
              {team ? "Save changes" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- members dialog */

interface ManageTeamMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team | null;
  departmentName: string;
  onChanged: () => void;
}

export function ManageTeamMembersDialog({ open, onOpenChange, team, departmentName, onChanged }: ManageTeamMembersDialogProps) {
  const { profile } = useAuth();
  const { options: departmentOptions } = useDepartmentOptions();
  const { teams } = useTeamOptions();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [movingCount, setMovingCount] = useState(0);

  const { data: employees = [], isLoading, isError, refetch } = useQuery<Employee[]>({
    queryKey: ["team-members-picker"],
    enabled: Boolean(team),
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employees").select("*").order("full_name").limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  // Initialise the selection to the team's current members, but only once the
  // employee query has finished loading — otherwise the picker would open empty.
  const initializedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !team || isLoading) return;
    if (initializedRef.current === team.id) return;
    initializedRef.current = team.id;
    setSelected(new Set(employees.filter((employee) => employee.team_id === team.id).map((employee) => employee.id)));
    setSearch("");
    setDepartment("all");
    setStatus("all");
  }, [open, team?.id, employees, isLoading]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const teamById = useMemo(() => new Map(teams.map((teamRow) => [teamRow.id, teamRow])), [teams]);
  const departmentNameById = useMemo(
    () => new Map(departmentOptions.map((option) => [option.value, option.label])),
    [departmentOptions],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (department !== "all" && employee.department_id !== department) return false;
      if (status !== "all" && employee.status !== status) return false;
      if (!term) return true;
      return (
        employee.full_name.toLowerCase().includes(term) ||
        employee.code.toLowerCase().includes(term) ||
        (employee.job_title ?? "").toLowerCase().includes(term)
      );
    });
  }, [department, employees, search, status]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!team) return;
      const currentMembers = new Set(
        employees.filter((employee) => employee.team_id === team.id).map((employee) => employee.id),
      );
      const add = Array.from(selected).filter((id) => !currentMembers.has(id));
      const remove = Array.from(currentMembers).filter((id) => !selected.has(id));
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string; failures?: string[] }>(
        "team-management",
        {
          body: { action: "assign_members", team_id: team.id, add, remove },
          headers: { "Content-Type": "application/json" },
        },
      );
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.message ?? "Membership could not be updated.");
      if (data.failures?.length) throw new Error(data.failures.join("; "));
      return { added: add.length, removed: remove.length };
    },
    onSuccess: (result) => {
      toast.success(`${result.added} added · ${result.removed} removed`);
      setConfirmOpen(false);
      onChanged();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleConfirmRequest = () => {
    if (!team) return;
    const movedFromOtherTeam = Array.from(selected).filter((id) => {
      const employee = employeeById.get(id);
      return employee && employee.team_id && employee.team_id !== team.id;
    }).length;
    setMovingCount(movedFromOtherTeam);
    setConfirmOpen(true);
  };

  const currentTeamIds = useMemo(
    () => new Set(employees.filter((employee) => employee.team_id === team?.id).map((employee) => employee.id)),
    [employees, team?.id],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Manage team members · {team?.name}</DialogTitle>
            <DialogDescription>
              {departmentName} · {team?.team_code} · {selected.size} selected on the team
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            <FilterBar>
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, code or job title…" />
              <SelectFilter label="Department" value={department} onChange={setDepartment} options={departmentOptions} />
              <SelectFilter
                label="Status"
                value={status}
                onChange={setStatus}
                options={EMPLOYEE_STATUS_OPTIONS.map((option) => ({ value: option, label: EMPLOYEE_STATUS_LABELS[option] }))}
              />
              <ClearFiltersButton
                visible={Boolean(search) || department !== "all" || status !== "all"}
                onClick={() => {
                  setSearch("");
                  setDepartment("all");
                  setStatus("all");
                }}
              />
            </FilterBar>

            <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
              {isLoading ? (
                <div className="p-4">
                  <TableSkeleton rows={8} columns={4} />
                </div>
              ) : isError ? (
                <div className="p-4">
                  <ErrorState onRetry={() => void refetch()} />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-4">
                  <EmptyState title="No employees match" description="Adjust the filters to see employees." />
                </div>
              ) : (
                <div className="hr-scroll-area min-h-0 flex-1 overflow-y-auto">
                  <ul className="divide-y divide-border">
                    {filtered.map((employee) => {
                      const isSelected = selected.has(employee.id);
                      const isCurrentMember = currentTeamIds.has(employee.id);
                      const otherTeam = employee.team_id && employee.team_id !== team?.id ? teamById.get(employee.team_id) : null;
                      return (
                        <li key={employee.id}>
                          <label
                            className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                              isSelected ? "bg-primary-soft" : "hover:bg-muted/40"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggle(employee.id)}
                              className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                              aria-label={`Select ${employee.full_name}`}
                            />
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
                                {initials(employee.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{employee.full_name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                <span className="font-mono">{employee.code}</span> · {employee.job_title ?? "—"} ·{" "}
                                {departmentNameById.get(employee.department_id ?? "") ?? "—"}
                              </p>
                            </div>
                            <div className="hidden shrink-0 items-center gap-2 sm:flex">
                              {otherTeam ? (
                                <ToneBadge tone="workflow">Currently in {otherTeam.name}</ToneBadge>
                              ) : isCurrentMember ? (
                                <ToneBadge tone="success">Member</ToneBadge>
                              ) : null}
                              <StatusBadge value={employee.status} labels={EMPLOYEE_STATUS_LABELS} tones={EMPLOYEE_STATUS_TONE} />
                            </div>
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/40 text-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              <Check className="h-3 w-3" />
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 pt-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmRequest} disabled={submit.isPending || !team}>
              {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Apply membership ({selected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply team membership changes?"
        description={
          movingCount > 0
            ? `${movingCount} selected employee${movingCount === 1 ? "" : "s"} currently belong to another team and will be moved here. Team changes are recorded in the audit history and broadcast in realtime.`
            : "The selected membership will be applied. Employees removed from this team are unassigned — never deleted — and their full history is preserved."
        }
        confirmLabel="Apply changes"
        busy={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
    </>
  );
}

export function TeamLeadControl({ team, onChanged }: { team: Team | null; onChanged: () => void }) {
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["team-lead-options", team?.id],
    enabled: Boolean(team),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select("*")
        .eq("team_id", team!.id)
        .order("full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Employee[];
    },
  });

  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const activeMembers = employees.filter((employee) => employee.status === "active");

  const assignLead = async (leadId: string) => {
    if (!team) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("team-management", {
      body: { action: "set_lead", team_id: team.id, team_lead_id: leadId || null },
      headers: { "Content-Type": "application/json" },
    });
    setSaving(false);
    if (error || !data?.ok) {
      toast.error(data?.message ?? error?.message ?? "Team lead could not be updated.");
      return;
    }
    toast.success(leadId ? "Team lead assigned." : "Team lead cleared.");
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Team lead</Label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={team?.team_lead_id ?? ""}
            onChange={(event) => void assignLead(event.target.value)}
            disabled={saving || !team}
            className="h-10 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            aria-label="Team lead"
          >
            <option value="">No team lead</option>
            {activeMembers.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.full_name} ({employee.code})
              </option>
            ))}
          </select>
          {team?.team_lead_id ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setClearOpen(true)} disabled={saving}>
              Clear
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Team leads must be active employees of this team. Clearing the lead requires explicit confirmation.
        </p>
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear the team lead?"
        description="The team will have no lead until you assign one. This is recorded in the audit history."
        confirmLabel="Clear team lead"
        destructive
        busy={saving}
        onConfirm={() => {
          setClearOpen(false);
          void assignLead("");
        }}
      />
    </div>
  );
}
