import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/db";
import type { AttendanceRecord, Employee, HrAction, PerformanceReview, Signal, Team } from "@/lib/types";

export interface TeamMetricRow {
  team: Team;
  headcount: number;
  active: number;
  exited: number;
  capacity: number | null;
  utilization: number | null;
  averagePerformance: number | null;
  previousScore: number | null;
  trend: number | null;
  goalCompletion: number | null;
  taskCompletion: number | null;
  reviewCompletion: number;
  attendanceRate: number | null;
  lateOrAbsent: number;
  highCriticalRisks: number;
  openActions: number;
  leadName: string | null;
}

/** Pure aggregation over stored records — performance and attendance stay separate datasets. */
export function computeTeamMetrics(
  teams: Team[],
  employees: Employee[],
  attendance: AttendanceRecord[],
  reviews: PerformanceReview[],
  signals: Signal[],
  actions: HrAction[],
): TeamMetricRow[] {
  const byTeam = new Map<string, Employee[]>();
  for (const employee of employees) {
    if (!employee.team_id) continue;
    if (!byTeam.has(employee.team_id)) byTeam.set(employee.team_id, []);
    byTeam.get(employee.team_id)!.push(employee);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  // Latest + previous submitted review per employee.
  const latestReview = new Map<string, PerformanceReview>();
  const previousReview = new Map<string, PerformanceReview>();
  const submitted = reviews
    .filter((review) => review.status !== "draft")
    .sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)));
  for (const review of submitted) {
    if (!latestReview.has(review.employee_id)) latestReview.set(review.employee_id, review);
    else if (!previousReview.has(review.employee_id)) previousReview.set(review.employee_id, review);
  }

  // Signals + linked open actions, indexed by employee.
  const signalsByEmployee = new Map<string, Signal[]>();
  for (const signal of signals) {
    if (signal.entity_type !== "employee") continue;
    if (!signalsByEmployee.has(signal.entity_id)) signalsByEmployee.set(signal.entity_id, []);
    signalsByEmployee.get(signal.entity_id)!.push(signal);
  }
  const signalIdsByEmployee = new Map<string, Set<string>>();
  for (const [employeeId, list] of signalsByEmployee) {
    signalIdsByEmployee.set(employeeId, new Set(list.map((signal) => signal.id)));
  }
  const openActions = actions.filter((action) => !["resolved", "failed", "dismissed"].includes(action.status));

  return teams.map((team) => {
    const members = byTeam.get(team.id) ?? [];
    const memberIds = new Set(members.map((member) => member.id));
    const active = members.filter((member) => member.status !== "exited");
    const exited = members.filter((member) => member.status === "exited");

    const scored = active
      .map((member) => latestReview.get(member.id)?.performance_score)
      .filter((score): score is number => score != null);
    const averagePerformance = scored.length
      ? scored.reduce((total, score) => total + Number(score), 0) / scored.length
      : null;

    const previous = active
      .map((member) => previousReview.get(member.id)?.performance_score)
      .filter((score): score is number => score != null);
    const previousScore = previous.length
      ? previous.reduce((total, score) => total + Number(score), 0) / previous.length
      : null;
    const trend = averagePerformance != null && previousScore != null ? averagePerformance - previousScore : null;

    const goalScores = active
      .map((member) => latestReview.get(member.id)?.goal_score)
      .filter((score): score is number => score != null);
    const taskScores = active
      .map((member) => latestReview.get(member.id)?.task_score)
      .filter((score): score is number => score != null);
    const goalCompletion = goalScores.length
      ? goalScores.reduce((total, score) => total + Number(score), 0) / goalScores.length
      : null;
    const taskCompletion = taskScores.length
      ? taskScores.reduce((total, score) => total + Number(score), 0) / taskScores.length
      : null;

    const reviewCompletion = active.length
      ? (active.filter((member) => latestReview.has(member.id)).length / active.length) * 100
      : 0;

    const teamAttendance = attendance.filter(
      (record) => memberIds.has(record.employee_id) && ["present", "late", "half-day", "absent"].includes(record.status),
    );
    const credited = teamAttendance.reduce((total, record) => {
      if (record.status === "present") return total + 1;
      if (record.status === "late" || record.status === "half-day") return total + 0.5;
      return total;
    }, 0);
    const attendanceRate = teamAttendance.length ? (credited / teamAttendance.length) * 100 : null;

    const recent = attendance.filter(
      (record) => memberIds.has(record.employee_id) && record.attendance_date >= cutoffIso,
    );
    const lateOrAbsent = recent.filter((record) => record.status === "late" || record.status === "absent").length;

    const memberSignals = Array.from(memberIds).flatMap((id) => signalsByEmployee.get(id) ?? []);
    const highCriticalRisks = memberSignals.filter(
      (signal) => Number(signal.score) >= 60 || signal.severity === "critical" || signal.severity === "high",
    ).length;

    const teamSignalIds = Array.from(memberIds).flatMap((id) => Array.from(signalIdsByEmployee.get(id) ?? []));
    const teamSignalSet = new Set(teamSignalIds);
    const openActionCount = openActions.filter(
      (action) => action.source_type === "signal" && action.source_ref && teamSignalSet.has(action.source_ref),
    ).length;

    const lead = members.find((member) => member.id === team.team_lead_id);

    return {
      team,
      headcount: members.length,
      active: active.length,
      exited: exited.length,
      capacity: team.capacity,
      utilization: team.capacity ? (active.length / team.capacity) * 100 : null,
      averagePerformance,
      previousScore,
      trend,
      goalCompletion,
      taskCompletion,
      reviewCompletion,
      attendanceRate,
      lateOrAbsent,
      highCriticalRisks,
      openActions: openActionCount,
      leadName: lead?.full_name ?? null,
    };
  });
}

/** Loads the raw records and derives team metrics in one query. */
export function useTeamMetrics(teamIds?: string[]) {
  const query = useQuery({
    queryKey: ["team-metrics", teamIds?.join(",") ?? "all"],
    queryFn: async () => {
      const [teams, employees, attendance, reviews, signals, actions] = await Promise.all([
        supabase.from("hr_teams").select("*").order("name"),
        supabase.from("hr_employees").select("*").limit(2000),
        supabase.from("hr_attendance").select("employee_id, status, attendance_date").limit(20000),
        supabase.from("hr_performance_reviews").select("employee_id, period_end, performance_score, goal_score, task_score, status").order("period_end", { ascending: false }).limit(5000),
        supabase.from("hr_signals").select("id, entity_type, entity_id, score, severity").limit(2000),
        supabase.from("hr_actions").select("id, source_type, source_ref, status").limit(500),
      ]);
      const firstError = [teams, employees, attendance, reviews, signals, actions].find((result) => result.error)?.error;
      if (firstError) throw new Error(firstError.message);

      const allTeams = (teams.data ?? []) as Team[];
      const scopedTeams = teamIds ? allTeams.filter((team) => teamIds.includes(team.id)) : allTeams;
      return computeTeamMetrics(
        scopedTeams,
        (employees.data ?? []) as Employee[],
        (attendance.data ?? []) as AttendanceRecord[],
        (reviews.data ?? []) as PerformanceReview[],
        (signals.data ?? []) as Signal[],
        (actions.data ?? []) as HrAction[],
      );
    },
  });

  const byTeamId = useMemo(() => new Map((query.data ?? []).map((row) => [row.team.id, row])), [query.data]);
  return { ...query, byTeamId };
}
