/** Chart palette sourced from the design-system tokens so charts match the UI. */
export const CHART_COLORS = {
  primary: "hsl(243 75% 55%)",
  insight: "hsl(262 80% 50%)",
  workflow: "hsl(189 94% 38%)",
  success: "hsl(160 84% 32%)",
  warning: "hsl(32 95% 44%)",
  critical: "hsl(347 77% 47%)",
  muted: "hsl(215 16% 65%)",
};

export const CHART_SERIES = [
  CHART_COLORS.primary,
  CHART_COLORS.insight,
  CHART_COLORS.workflow,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.critical,
];

export const SEVERITY_COLORS: Record<string, string> = {
  low: CHART_COLORS.success,
  medium: CHART_COLORS.warning,
  high: CHART_COLORS.critical,
  critical: CHART_COLORS.critical,
};

export const axisStyle = {
  tick: { fill: "hsl(215 16% 47%)", fontSize: 11 },
  axisLine: { stroke: "hsl(214 32% 91%)" },
  tickLine: false,
} as const;

export const gridStyle = {
  stroke: "hsl(214 32% 91%)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

export const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid hsl(214 32% 91%)",
    boxShadow: "0 4px 16px -4px rgb(15 23 42 / 0.12)",
    fontSize: 12,
  },
  labelStyle: { color: "hsl(222 47% 11%)", fontWeight: 600 },
} as const;
