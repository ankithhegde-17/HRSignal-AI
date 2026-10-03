import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/brand";
import { ROLE_HOME, useAuth } from "@/providers/auth-provider";

const HIGHLIGHTS = [
  "Verified workforce data connected end to end",
  "Deterministic risk signals with an auditable formula",
  "Executive approvals with a complete history",
];

export default function LoginPage() {
  const { session, profile, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Sign in · HR Signal AI";
  }, []);

  if (!loading && session && profile) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? ROLE_HOME[profile.role] ?? "/dashboard"} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter both your email address and password.");
      return;
    }

    setSubmitting(true);
    const result = await signIn(email, password, remember);
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hr-brand-gradient relative hidden flex-col justify-between p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/15">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-tight">HR Signal AI</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Turn disconnected HR records into verified decisions.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-primary-foreground/85">
            Attendance, performance, recruitment and risk signals converge into one auditable workforce picture —
            with every decision recorded.
          </p>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-primary-foreground/90">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-foreground/70" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-primary-foreground/70">
          Access is provisioned by invitation. Public registration is disabled.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center bg-background px-5 py-10 sm:px-8">
        <div className="glass-solid w-full max-w-sm rounded-xl border p-6 shadow-glass">
          <div className="lg:hidden">
            <Brand to={undefined} tone="default" />
          </div>

          <h1 className="mt-8 text-2xl font-semibold tracking-tight lg:mt-0">Sign in to HR Signal AI</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use the credentials issued to your account. There is no public sign-up.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="pl-9"
                  aria-invalid={Boolean(error)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                  aria-invalid={Boolean(error)}
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked === true)}
                disabled={submitting}
              />
              <Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-muted-foreground">
                Keep me signed in on this device
              </Label>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Sessions are protected by role-based access. Sensitive operations such as approvals and workforce
            changes are authorised on the server, not only in the interface.
          </p>
        </div>
      </div>
    </div>
  );
}
