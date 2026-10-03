import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { ToneBadge } from "@/components/shared/badges";
import { supabase } from "@/lib/db";
import { useHrProfiles } from "@/hooks/use-lookups";
import { PRIORITY_LABELS, PRIORITY_OPTIONS, ROLE_LABELS, type Priority } from "@/lib/types";
import { toast } from "sonner";

export interface CreateActionSeed {
  title: string;
  description?: string;
  source_type: "signal" | "insight" | "recommendation" | "manual" | "candidate_conversion" | "attendance_import";
  source_ref?: string | null;
  recommendedPriority?: Priority;
  sensitive?: boolean;
}

interface CreateActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed: CreateActionSeed | null;
  onCreated?: () => void;
}

/**
 * Creates a tracked action from a verified signal or recommendation. Sensitive
 * actions are flagged for Founder/CEO approval — the backend enforces the rule.
 */
export function CreateActionDialog({ open, onOpenChange, seed, onCreated }: CreateActionDialogProps) {
  const queryClient = useQueryClient();
  const { data: hrProfiles } = useHrProfiles();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !seed) return;
    setTitle(seed.title);
    setDescription(seed.description ?? "");
    setPriority(seed.recommendedPriority ?? "medium");
    setAssignedTo("");
    setSensitive(Boolean(seed.sensitive));
    const due = new Date();
    due.setDate(due.getDate() + 14);
    setDueDate(due.toISOString().slice(0, 10));
    setError(null);
  }, [open, seed]);

  const createAction = useMutation({
    mutationFn: async () => {
      const { data, error: invokeError } = await supabase.functions.invoke<{ ok: boolean; message?: string; action?: { id: string } }>(
        "action-workflow",
        {
          body: {
            action: "create",
            title,
            description,
            source_type: seed?.source_type ?? "manual",
            source_ref: seed?.source_ref ?? null,
            priority,
            assigned_to: assignedTo || null,
            due_date: dueDate || null,
            sensitivity: sensitive ? "sensitive" : "routine",
            approval_required: sensitive,
          },
          headers: { "Content-Type": "application/json" },
        },
      );
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.ok) throw new Error(data?.message ?? "The action could not be created.");
      return data;
    },
    onSuccess: () => {
      toast.success(sensitive ? "Action created and flagged for Founder/CEO approval." : "Action created and assigned.");
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated?.();
      onOpenChange(false);
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create action</DialogTitle>
          <DialogDescription>
            Actions carry an owner, priority and due date. Every state change is recorded in the workflow history.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) {
              setError("A title is required.");
              return;
            }
            setError(null);
            createAction.mutate();
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Title *</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={createAction.isPending} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Description</Label>
            <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={createAction.isPending} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Priority</Label>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as Priority)}
                disabled={createAction.isPending}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {PRIORITY_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Due date</Label>
              <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={createAction.isPending} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Owner</Label>
            <select
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
              disabled={createAction.isPending}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Assign to me</option>
              {(hrProfiles ?? []).map((profile) => (
                <option key={profile.user_id} value={profile.user_id}>
                  {profile.full_name} ({ROLE_LABELS[profile.role]})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Actions are owned by an HR Signal AI user. The owner is notified as soon as the action is created.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3">
            <input
              id="sensitive-action"
              type="checkbox"
              checked={sensitive}
              onChange={(event) => setSensitive(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
              disabled={createAction.isPending}
            />
            <div>
              <Label htmlFor="sensitive-action" className="cursor-pointer text-sm font-medium">
                This is a sensitive action
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Sensitive actions require Founder/CEO approval before work can begin. The backend enforces this, not the
                interface.
              </p>
              {sensitive ? (
                <ToneBadge tone="warning" className="mt-2">
                  Approval required
                </ToneBadge>
              ) : null}
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createAction.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createAction.isPending}>
              {createAction.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Create action
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
