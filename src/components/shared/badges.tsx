import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EVIDENCE_QUALITY_LABELS,
  SEVERITY_LABELS,
  type EvidenceQuality,
  type Severity,
  type Tone,
} from "@/lib/types";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  primary: "border-primary/25 bg-primary-soft text-primary",
  insight: "border-insight/25 bg-insight-soft text-insight",
  workflow: "border-workflow/25 bg-workflow-soft text-workflow",
  success: "border-success/25 bg-success-soft text-success",
  warning: "border-warning/25 bg-warning-soft text-warning",
  critical: "border-destructive/25 bg-destructive-soft text-destructive",
  info: "border-info/25 bg-info-soft text-info",
};

const TONE_ICONS: Partial<Record<Tone, typeof Info>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: ShieldAlert,
  neutral: CircleDashed,
};

export function ToneBadge({
  tone = "neutral",
  children,
  className,
  showIcon = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  showIcon?: boolean;
}) {
  const Icon = showIcon ? TONE_ICONS[tone] : undefined;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Generic label badge: the tone comes from a label→tone map supplied by the caller. */
export function StatusBadge<T extends string>({
  value,
  labels,
  tones,
  className,
  showIcon,
}: {
  value: T;
  labels: Record<T, string>;
  tones: Record<T, Tone>;
  className?: string;
  showIcon?: boolean;
}) {
  const tone = tones[value] ?? "neutral";
  return (
    <ToneBadge tone={tone} className={className} showIcon={showIcon}>
      {labels[value] ?? value}
    </ToneBadge>
  );
}

/**
 * Risk badge — severity is always paired with the numeric score, so the signal is
 * never communicated by colour alone.
 */
export function RiskBadge({
  score,
  severity,
  className,
}: {
  score?: number | null;
  severity?: Severity;
  className?: string;
}) {
  const resolvedSeverity: Severity =
    severity ?? (score == null ? "low" : score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low");
  const tone: Tone =
    resolvedSeverity === "critical" ? "critical" : resolvedSeverity === "high" ? "critical" : resolvedSeverity === "medium" ? "warning" : "success";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className="font-semibold">{SEVERITY_LABELS[resolvedSeverity]}</span>
      {score != null ? <span className="tabular-nums opacity-80">{Number(score).toFixed(0)}</span> : null}
    </span>
  );
}

export function EvidenceQualityBadge({ quality, className }: { quality: EvidenceQuality; className?: string }) {
  const tone: Tone =
    quality === "strong" ? "success" : quality === "moderate" ? "info" : quality === "limited" ? "warning" : "neutral";
  return (
    <ToneBadge tone={tone} className={className} showIcon>
      {EVIDENCE_QUALITY_LABELS[quality]}
    </ToneBadge>
  );
}

/** Compact severity scale used in legends and filters. */
export function SeverityLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)}>
      {(["low", "medium", "high", "critical"] as Severity[]).map((severity) => (
        <span key={severity} className="inline-flex items-center gap-1">
          <RiskBadge severity={severity} />
        </span>
      ))}
    </div>
  );
}
