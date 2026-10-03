import { FilterProvider } from "./providers/filter-provider";
import { Employee360Provider } from "./providers/employee-360-provider";
import { AppShell } from "./components/app-shell";
import { RequireAuth, RequireRole, RoleRedirect } from "./components/guards";
import { RouteErrorPage } from "./components/error-boundary";

import LoginPage from "./pages/login";
import HelpPage from "./pages/help";
import SettingsPage from "./pages/settings";
import DashboardPage from "./pages/dashboard";
import AttendancePage from "./pages/attendance";
import PerformanceDepartmentsPage from "./pages/performance/departments";
import PerformanceEmployeesPage from "./pages/performance/employees";
import WorkforceEmployeesPage from "./pages/workforce/employees";
import WorkforceDepartmentsPage from "./pages/workforce/departments";
import DepartmentDetailPage from "./pages/workforce/department-detail";
import TeamDetailPage from "./pages/workforce/team-detail";
import WorkforceStatusPage from "./pages/workforce/status";
import WorkforceWorkModePage from "./pages/workforce/work-mode";
import WorkforceAnalyticsPage from "./pages/workforce/analytics";
import RecruitmentPage from "./pages/recruitment";
import OrganizationInsightsPage from "./pages/insights/organization";
import RiskMonitorPage from "./pages/insights/risks";
import RecommendationsPage from "./pages/insights/recommendations";
import AskHrSignalPage from "./pages/insights/ask";
import ActionsPage from "./pages/actions";
import ExecutiveOverviewPage from "./pages/executive/overview";
import ExecutiveHrTeamPage from "./pages/executive/hr-team";
import ExecutiveWorkforceHealthPage from "./pages/executive/workforce-health";
import ExecutiveInsightsPage from "./pages/executive/insights";
import ExecutiveApprovalsPage from "./pages/executive/approvals";
import NotFound from "./pages/NotFound";

/** HR role routes. Every entry is ownership-checked on the backend as well as here. */
const hrRoutes = [
  { path: "dashboard", element: <DashboardPage /> },
  { path: "attendance", element: <AttendancePage /> },
  { path: "performance/departments", element: <PerformanceDepartmentsPage /> },
  { path: "performance/employees", element: <PerformanceEmployeesPage /> },
  { path: "workforce/employees", element: <WorkforceEmployeesPage /> },
  { path: "workforce/departments", element: <WorkforceDepartmentsPage /> },
  { path: "workforce/status", element: <WorkforceStatusPage /> },
  { path: "workforce/work-mode", element: <WorkforceWorkModePage /> },
  { path: "workforce/analytics", element: <WorkforceAnalyticsPage /> },
  { path: "recruitment", element: <RecruitmentPage /> },
  { path: "insights/organization", element: <OrganizationInsightsPage /> },
  { path: "insights/risks", element: <RiskMonitorPage /> },
  { path: "insights/recommendations", element: <RecommendationsPage /> },
  { path: "insights/ask", element: <AskHrSignalPage /> },
  { path: "actions", element: <ActionsPage /> },
  { path: "help", element: <HelpPage /> },
  { path: "settings", element: <SettingsPage variant="hr" /> },
].map((route) => ({
  ...route,
  element: <RequireRole role="hr">{route.element}</RequireRole>,
}));

/** Founder/CEO routes — read-focused, with approvals as the writable surface. */
const executiveRoutes = [
  { path: "executive", element: <ExecutiveOverviewPage /> },
  { path: "executive/hr-team", element: <ExecutiveHrTeamPage /> },
  { path: "executive/workforce-health", element: <ExecutiveWorkforceHealthPage /> },
  { path: "executive/insights", element: <ExecutiveInsightsPage /> },
  { path: "executive/approvals", element: <ExecutiveApprovalsPage /> },
  { path: "executive/settings", element: <SettingsPage variant="executive" /> },
].map((route) => ({
  ...route,
  element: <RequireRole role="founder">{route.element}</RequireRole>,
}));

export const routers = [
  {
    path: "/login",
    name: "login",
    element: <LoginPage />,
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/",
    name: "app",
    element: (
      <RequireAuth>
        <FilterProvider>
          <Employee360Provider>
            <AppShell />
          </Employee360Provider>
        </FilterProvider>
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <RoleRedirect /> },
      ...hrRoutes,
      ...executiveRoutes,
      // Department → Team drill-down is read-available to both roles; mutations
      // are gated to HR inside the pages and enforced on the backend.
      { path: "workforce/departments/:departmentId", element: <DepartmentDetailPage /> },
      { path: "workforce/departments/:departmentId/teams/:teamId", element: <TeamDetailPage /> },
    ],
  },
  /* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */
  {
    path: "*",
    name: "404",
    element: <NotFound />,
  },
];

declare global {
  interface Window {
    __routers__: typeof routers;
  }
}

window.__routers__ = routers;
