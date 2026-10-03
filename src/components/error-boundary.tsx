import { Component, type ErrorInfo, type ReactNode } from "react";
import { useNavigate, useRouteError } from "react-router-dom";
import { AlertOctagon, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Branded recovery screen shown after any uncaught error. It deliberately shows
 * a concise, generic message — no stack traces or internal details — and logs
 * technical information only to the console (the development/error channel).
 */
export function RecoveryScreen({ onRetry, onDashboard }: { onRetry: () => void; onDashboard: () => void }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-raised">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive-soft text-destructive">
          <AlertOctagon className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">HR Signal AI hit an unexpected error</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The page could not be rendered. Your data is safe — nothing was changed. Try again, or return to your
          dashboard.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button variant="outline" onClick={onDashboard}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Return to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

/** React Router errorElement: keeps the developer error out of the UI. */
export function RouteErrorPage() {
  const error = useRouteError();
  // Technical details belong to the error/development channel, not the screen.
  console.error("[HR Signal AI] Route error:", error);
  const navigate = useNavigate();
  return (
    <RecoveryScreen
      onRetry={() => navigate(0)}
      onDashboard={() => navigate("/")}
    />
  );
}

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Class boundary wrapped around the router so render errors raised anywhere in
 * the tree (including providers) surface the branded recovery screen.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[HR Signal AI] Unhandled render error:", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  handleDashboard = () => {
    window.location.assign("/");
  };

  render() {
    if (this.state.hasError) {
      return <RecoveryScreen onRetry={this.handleRetry} onDashboard={this.handleDashboard} />;
    }
    return this.props.children;
  }
}
