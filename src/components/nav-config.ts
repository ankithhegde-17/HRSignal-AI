import {
  Activity,
  BarChart3,
  Building2,
  ClipboardList,
  Compass,
  Gauge,
  HeartPulse,
  HelpCircle,
  LayoutDashboard,
  Lightbulb,
  MapPin,
  MessageSquareText,
  Settings,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  UserSearch,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  description?: string;
}

export interface NavGroup {
  label: string;
  icon?: LucideIcon;
  items: NavItem[];
}

export const HR_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, description: "Workforce KPIs and trends" }],
  },
  {
    label: "Attendance",
    items: [{ label: "Attendance", to: "/attendance", icon: ClipboardList, description: "Imports, analytics and exceptions" }],
  },
  {
    label: "Performance",
    icon: TrendingUp,
    items: [
      { label: "Departments", to: "/performance/departments", icon: Building2, description: "Department performance" },
      { label: "Employees", to: "/performance/employees", icon: UserCheck, description: "Reviews and scores" },
    ],
  },
  {
    label: "Workforce",
    icon: Users,
    items: [
      { label: "Employees", to: "/workforce/employees", icon: Users, description: "Employee directory" },
      { label: "Departments", to: "/workforce/departments", icon: Building2, description: "Departments and heads" },
      { label: "Employee Status", to: "/workforce/status", icon: Activity, description: "Active, notice, leave, exited" },
      { label: "Work Mode", to: "/workforce/work-mode", icon: MapPin, description: "Onsite, remote, hybrid" },
      { label: "More Analytics", to: "/workforce/analytics", icon: BarChart3, description: "Composition and distribution" },
    ],
  },
  {
    label: "Recruitment",
    items: [{ label: "Recruitment", to: "/recruitment", icon: UserSearch, description: "Requisitions and candidates" }],
  },
  {
    label: "AI Insights",
    icon: Sparkles,
    items: [
      { label: "Organization Insights", to: "/insights/organization", icon: Lightbulb, description: "Verified patterns" },
      { label: "Risk Monitor", to: "/insights/risks", icon: ShieldAlert, description: "Signals and evidence" },
      { label: "Recommendations", to: "/insights/recommendations", icon: Compass, description: "Suggested next steps" },
      { label: "Ask HR Signal", to: "/insights/ask", icon: MessageSquareText, description: "Grounded assistant" },
    ],
  },
  {
    label: "Action Center",
    items: [{ label: "Actions", to: "/actions", icon: Gauge, description: "Queue, approvals and history" }],
  },
  {
    label: "Help & Support",
    items: [{ label: "Help & Support", to: "/help", icon: HelpCircle, description: "Guides and workflows" }],
  },
  {
    label: "Settings",
    items: [{ label: "Settings", to: "/settings", icon: Settings, description: "Profile and preferences" }],
  },
];

export const EXECUTIVE_NAV: NavGroup[] = [
  {
    label: "Executive",
    items: [
      { label: "Executive Overview", to: "/executive", icon: LayoutDashboard, description: "Workforce at a glance" },
      { label: "HR Team", to: "/executive/hr-team", icon: Users, description: "HR performance and load" },
      { label: "Workforce Health", to: "/executive/workforce-health", icon: HeartPulse, description: "Attrition and capacity" },
    ],
  },
  {
    label: "AI Insights",
    items: [{ label: "Executive Insights", to: "/executive/insights", icon: Lightbulb, description: "Verified risks and recommendations" }],
  },
  {
    label: "Approvals",
    items: [{ label: "Approvals", to: "/executive/approvals", icon: UserCheck, description: "Sensitive action decisions" }],
  },
  {
    label: "Settings",
    items: [{ label: "Settings", to: "/executive/settings", icon: Settings, description: "Profile and preferences" }],
  },
];

export function navForRole(role: Role | null | undefined): NavGroup[] {
  return role === "founder" ? EXECUTIVE_NAV : HR_NAV;
}

/** Flattens the navigation into a lookup used for page titles and breadcrumbs. */
export function navLookup(role: Role | null | undefined) {
  const map = new Map<string, { group: string; item: NavItem }>();
  navForRole(role).forEach((group) => {
    group.items.forEach((item) => map.set(item.to, { group: group.label, item }));
  });
  return map;
}
