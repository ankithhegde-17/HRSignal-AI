import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ROLE_HOME, useAuth } from "@/providers/auth-provider";
import type { Role } from "@/lib/types";

function AuthLoading() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Loading HR Signal AI…</p>
      </div>
    </div>
  );
}

/** Blocks unauthenticated access and bounces to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoading />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Enforces the application role; mismatches are sent to that role's home route. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) return <AuthLoading />;
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-card">
          <h1 className="text-lg font-semibold">Account not provisioned</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This account has no HR Signal AI profile. Contact an administrator to have access granted.
          </p>
        </div>
      </div>
    );
  }
  if (profile.role !== role) {
    return <Navigate to={ROLE_HOME[profile.role] ?? "/login"} replace />;
  }
  return <>{children}</>;
}

/** Root redirect: sends each signed-in user to their role home. */
export function RoleRedirect() {
  const { session, profile, loading } = useAuth();

  if (loading) return <AuthLoading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <AuthLoading />;
  return <Navigate to={ROLE_HOME[profile.role] ?? "/login"} replace />;
}
