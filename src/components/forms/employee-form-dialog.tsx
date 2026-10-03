import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeOptions, useTeamOptions } from "@/hooks/use-lookups";
import { useAuth } from "@/providers/auth-provider";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_OPTIONS,
  WORK_MODE_LABELS,
  WORK_MODE_OPTIONS,
  type Employee,
  type EmployeeStatus,
  type EmploymentType,
  type WorkMode,
} from "@/lib/types";

export interface EmployeeFormValues {
  full_name: string;
  code: string;
  work_email: string;
  personal_email: string;
  phone: string;
  department_id: string;
  team_id: string;
  manager_id: string;
  job_title: string;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  location: string;
  joining_date: string;
  status: EmployeeStatus;
  skills: string;
}

function emptyValues(): EmployeeFormValues {
  return {
    full_name: "",
    code: "",
    work_email: "",
    personal_email: "",
    phone: "",
    department_id: "",
    team_id: "",
    manager_id: "",
    job_title: "",
    employment_type: "full-time",
    work_mode: "onsite",
    location: "",
    joining_date: new Date().toISOString().slice(0, 10),
    status: "active",
    skills: "",
  };
}

function fromEmployee(employee: Employee): EmployeeFormValues {
  return {
    full_name: employee.full_name,
    code: employee.code,
    work_email: employee.work_email ?? "",
    personal_email: employee.personal_email ?? "",
    phone: employee.phone ?? "",
    department_id: employee.department_id ?? "",
    team_id: employee.team_id ?? "",
    manager_id: employee.manager_id ?? "",
    job_title: employee.job_title ?? "",
    employment_type: employee.employment_type,
    work_mode: employee.work_mode,
    location: employee.location ?? "",
    joining_date: employee.joining_date ?? "",
    status: employee.status,
    skills: (employee.skills ?? []).join(", "),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmployeeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee | null;
  onSaved: (employee: Employee, mode: "created" | "updated") => void;
}

export function EmployeeFormDialog({ open, onOpenChange, employee, onSaved }: EmployeeFormDialogProps) {
  const { profile } = useAuth();
  const { options: departmentOptions } = useDepartmentOptions();
  const { options: managerOptions } = useEmployeeOptions();
  const [values, setValues] = useState<EmployeeFormValues>(emptyValues);
  const [errors, setErrors] = useState<Partial<Record<keyof EmployeeFormValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Team options depend on the current form values and must be declared after them.
  const { options: teamOptions } = useTeamOptions(values.department_id || null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    setValues(employee ? fromEmployee(employee) : emptyValues());
  }, [employee, open]);

  const set = <K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    const next: Partial<Record<keyof EmployeeFormValues, string>> = {};
    if (!values.full_name.trim()) next.full_name = "Full name is required.";
    if (!values.code.trim()) next.code = "Employee code is required.";
    else if (employee && values.code.trim() !== employee.code && !/^[A-Za-z0-9-]{2,}$/.test(values.code.trim()))
      next.code = "Use letters, numbers and hyphens only.";
    if (values.work_email && !EMAIL_PATTERN.test(values.work_email)) next.work_email = "Enter a valid work email.";
    if (values.personal_email && !EMAIL_PATTERN.test(values.personal_email))
      next.personal_email = "Enter a valid personal email.";
    if (!values.joining_date) next.joining_date = "Joining date is required.";
    if (values.status === "exited" && !values.joining_date) next.joining_date = "Joining date is required.";
    if (values.team_id && !values.department_id) next.team_id = "Select a department before choosing a team.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setSaving(true);
    const payload = {
      full_name: values.full_name.trim(),
      code: values.code.trim(),
      work_email: values.work_email.trim() || null,
      personal_email: values.personal_email.trim() || null,
      phone: values.phone.trim() || null,
      department_id: values.department_id || null,
      team_id: values.team_id || null,
      manager_id: values.manager_id || null,
      job_title: values.job_title.trim() || null,
      employment_type: values.employment_type,
      work_mode: values.work_mode,
      location: values.location.trim() || null,
      joining_date: values.joining_date || null,
      status: values.status,
      skills: values.skills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean),
    };

    try {
      if (employee) {
        const { data, error } = await supabase
          .from("hr_employees")
          .update(payload)
          .eq("id", employee.id)
          .select("*")
          .single();
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          actor_id: profile?.user_id ?? null,
          actor_email: profile?.email ?? null,
          entity_type: "employee",
          entity_id: employee.id,
          action: "employee_updated",
          before_json: employee as unknown as Record<string, unknown>,
          after_json: payload,
        });
        onSaved(data as Employee, "updated");
      } else {
        const { data, error } = await supabase.from("hr_employees").insert(payload).select("*").single();
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          actor_id: profile?.user_id ?? null,
          actor_email: profile?.email ?? null,
          entity_type: "employee",
          entity_id: data.id,
          action: "employee_created",
          after_json: payload,
        });
        onSaved(data as Employee, "created");
      }
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitError(
        /duplicate|unique/i.test(message)
          ? "An employee with that code or work email already exists."
          : message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? "Edit employee" : "Add employee"}</DialogTitle>
          <DialogDescription>
            Workforce is the master data source. Attendance, performance, recruitment and risk all reference these
            records.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.full_name}>
              <Input value={values.full_name} onChange={(e) => set("full_name", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Employee code" required error={errors.code}>
              <Input
                value={values.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="HRS-1001"
                disabled={saving || Boolean(employee)}
              />
            </Field>
            <Field label="Work email" error={errors.work_email}>
              <Input type="email" value={values.work_email} onChange={(e) => set("work_email", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Personal email" error={errors.personal_email}>
              <Input type="email" value={values.personal_email} onChange={(e) => set("personal_email", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Phone">
              <Input value={values.phone} onChange={(e) => set("phone", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Job title">
              <Input value={values.job_title} onChange={(e) => set("job_title", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Department">
              <Select
                value={values.department_id || "none"}
                onValueChange={(value) => {
                  const departmentId = value === "none" ? "" : value;
                  set("department_id", departmentId);
                  // A team belongs to a department: changing the department
                  // always clears the team so a cross-department mismatch can
                  // never be saved (the database enforces this too).
                  set("team_id", "");
                }}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {departmentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Team" error={errors.team_id} hint={!values.department_id ? "Select a department to choose its teams." : undefined}>
              <Select
                value={values.team_id || "none"}
                onValueChange={(value) => set("team_id", value === "none" ? "" : value)}
                disabled={saving || !values.department_id || teamOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={values.department_id ? "Select team" : "Choose department first"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teamOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Manager">
              <Select value={values.manager_id || "none"} onValueChange={(value) => set("manager_id", value === "none" ? "" : value)} disabled={saving}>
                <SelectTrigger>
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No manager</SelectItem>
                  {managerOptions
                    .filter((option) => option.value !== employee?.id)
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Employment type">
              <Select value={values.employment_type} onValueChange={(value) => set("employment_type", value as EmploymentType)} disabled={saving}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {EMPLOYMENT_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Work mode">
              <Select value={values.work_mode} onValueChange={(value) => set("work_mode", value as WorkMode)} disabled={saving}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {WORK_MODE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Location">
              <Input value={values.location} onChange={(e) => set("location", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Joining date" required error={errors.joining_date}>
              <Input type="date" value={values.joining_date} onChange={(e) => set("joining_date", e.target.value)} disabled={saving} />
            </Field>
            <Field label="Status">
              <Select value={values.status} onValueChange={(value) => set("status", value as EmployeeStatus)} disabled={saving}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {EMPLOYEE_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Skills" hint="Comma separated">
            <Textarea
              rows={2}
              value={values.skills}
              onChange={(e) => set("skills", e.target.value)}
              placeholder="TypeScript, React, SQL"
              disabled={saving}
            />
          </Field>

          {submitError ? (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          ) : null}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {employee ? "Save changes" : "Create employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  error,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
