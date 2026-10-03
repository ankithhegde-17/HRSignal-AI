import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LayoutPanelLeft, ShieldCheck, UserRound } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { ToneBadge } from "@/components/shared/badges";
import { QueryState, CardSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/db";
import { useAuth } from "@/providers/auth-provider";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { EMPLOYEE_STATUS_LABELS, ROLE_LABELS } from "@/lib/types";

const SIDEBAR_KEY = "hr-signal-sidebar-collapsed";

export default function SettingsPage({ variant = "hr" }: { variant?: "hr" | "executive" }) {
  const { profile, user, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [compactSidebar, setCompactSidebar] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");

  const auditQuery = useQuery({
    queryKey: ["settings-audit", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_audit_log")
        .select("*")
        .eq("actor_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from("hr_profiles")
      .update({ full_name: fullName.trim() || profile.full_name, phone: phone.trim() || null })
      .eq("user_id", profile.user_id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshProfile();
    toast.success("Profile updated.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your profile, access level and interface preferences."
        breadcrumbs={[{ label: variant === "executive" ? "Executive" : "Settings", to: variant === "executive" ? "/executive" : undefined }, { label: "Settings" }]}
      />

      <QueryState
        isLoading={!profile}
        isError={false}
        loadingFallback={<CardSkeleton count={3} />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-5 shadow-card">
            <SectionHeader title="Profile" description="Visible to other HR Signal AI users" />
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="settings-name" className="text-xs font-medium text-muted-foreground">
                  Full name
                </Label>
                <Input id="settings-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-phone" className="text-xs font-medium text-muted-foreground">
                  Phone
                </Label>
                <Input id="settings-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Email</Label>
                <Input value={profile?.email ?? user?.email ?? ""} readOnly className="bg-muted" />
                <p className="text-xs text-muted-foreground">
                  The sign-in address is managed by your administrator and cannot be changed here.
                </p>
              </div>
              <Button onClick={saveProfile} disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-5 shadow-card">
              <SectionHeader title="Access" description="Enforced on the backend and in the database" />
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Role</dt>
                  <dd>
                    <ToneBadge tone={profile?.role === "founder" ? "insight" : "primary"}>
                      {profile ? ROLE_LABELS[profile.role] : "—"}
                    </ToneBadge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Account status</dt>
                  <dd>
                    <ToneBadge tone={profile?.is_active ? "success" : "neutral"}>
                      {profile?.is_active ? "Active" : "Inactive"}
                    </ToneBadge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Last sign-in</dt>
                  <dd className="tabular-nums">{formatDateTime(profile?.last_login_at)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Default route</dt>
                  <dd className="font-mono text-xs">{profile?.role === "founder" ? "/executive" : "/dashboard"}</dd>
                </div>
              </dl>
              <p className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {profile?.role === "founder"
                  ? "Executive accounts are read-focused; only approvals and comments are writable."
                  : "HR accounts hold workforce, attendance, performance, recruitment and action permissions."}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow-card">
              <SectionHeader title="Interface preferences" />
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                  <LayoutPanelLeft className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <Label htmlFor="compact-sidebar" className="text-sm font-medium">
                      Compact sidebar
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Collapses navigation to icons. Stored locally as a harmless interface preference.
                    </p>
                  </div>
                </div>
                <Switch
                  id="compact-sidebar"
                  checked={compactSidebar}
                  onCheckedChange={(checked) => {
                    setCompactSidebar(checked);
                    localStorage.setItem(SIDEBAR_KEY, checked ? "1" : "0");
                  }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow-card">
              <SectionHeader title="Account security" />
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  Passwords are managed by your administrator through Enter Cloud authentication. Public registration and
                  social sign-in are disabled, so accounts can only be provisioned internally.
                </p>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card shadow-card">
          <SectionHeader
            className="border-b border-border px-5 py-4 pb-4"
            title="Your recent activity"
            description="Authentication and mutation events recorded against your account"
          />
          {(auditQuery.data ?? []).length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {auditQuery.data!.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm capitalize text-foreground">{entry.action.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.entity_type.replace(/_/g, " ")} · {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                  <ToneBadge tone="neutral">{entry.entity_type}</ToneBadge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
          Employee statuses available in the workforce: {Object.values(EMPLOYEE_STATUS_LABELS).join(", ")}.
        </p>
      </QueryState>
    </div>
  );
}
