// HR Signal AI :: deterministic, versioned workforce risk engine (risk-v1).
// All scores are computed server-side from verified stored data. The frontend only displays them.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FORMULA_VERSION = 'risk-v1';
const WEIGHTS = { attendance: 0.4, performance: 0.4, taskTrend: 0.2 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function severityFor(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchAll(admin: ReturnType<typeof createClient>, table: string, columns: string) {
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ ok: false, reason: 'backend_not_configured' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // Recomputing signals writes to hr_signals and hr_ai_insights, so it is an
    // HR mutation and must never be executable by an anonymous caller.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user?.id) return json({ ok: false, reason: 'unauthenticated' }, 401);

    const { data: callerProfile } = await admin
      .from('hr_profiles')
      .select('role, is_active')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (!callerProfile?.is_active || callerProfile.role !== 'hr') {
      return json(
        { ok: false, reason: 'forbidden', message: 'Risk recalculation is restricted to the HR role.' },
        403,
      );
    }

    const now = new Date();
    const attendanceCutoff = new Date(now);
    attendanceCutoff.setUTCDate(attendanceCutoff.getUTCDate() - 30);
    const cutoffIso = isoDate(attendanceCutoff);

    const [employees, departments, attendance, reviews, tasks, requisitions, candidates] = await Promise.all([
      fetchAll(admin, 'hr_employees', 'id, code, full_name, department_id, status, employment_type, joining_date, exit_date, work_mode'),
      fetchAll(admin, 'hr_departments', 'id, name, code, capacity'),
      fetchAll(admin, 'hr_attendance', 'employee_id, attendance_date, status'),
      fetchAll(admin, 'hr_performance_reviews', 'employee_id, performance_score, goal_score, task_score, period_end, status'),
      fetchAll(admin, 'hr_tasks', 'employee_id, status, due_date, completion_percent'),
      fetchAll(admin, 'hr_job_requisitions', 'id, department_id, openings, status'),
      fetchAll(admin, 'hr_candidates', 'id, requisition_id, current_stage, status'),
    ]);

    const attendanceByEmployee = new Map<string, Array<Record<string, unknown>>>();
    for (const row of attendance) {
      if ((row.attendance_date as string) < cutoffIso) continue;
      const key = row.employee_id as string;
      if (!attendanceByEmployee.has(key)) attendanceByEmployee.set(key, []);
      attendanceByEmployee.get(key)!.push(row);
    }

    const reviewsByEmployee = new Map<string, Array<Record<string, unknown>>>();
    for (const row of reviews) {
      const key = row.employee_id as string;
      if (!reviewsByEmployee.has(key)) reviewsByEmployee.set(key, []);
      reviewsByEmployee.get(key)!.push(row);
    }
    for (const list of reviewsByEmployee.values()) {
      list.sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)));
    }

    const tasksByEmployee = new Map<string, Array<Record<string, unknown>>>();
    for (const row of tasks) {
      const key = row.employee_id as string;
      if (!tasksByEmployee.has(key)) tasksByEmployee.set(key, []);
      tasksByEmployee.get(key)!.push(row);
    }

    const signalRows: Array<Record<string, unknown>> = [];
    const insights: Array<Record<string, unknown>> = [];
    const employeeMetrics: Array<Record<string, unknown>> = [];

    const activeEmployees = employees.filter((e) => e.status !== 'exited');

    for (const emp of activeEmployees) {
      const empId = emp.id as string;
      const empAttendance = attendanceByEmployee.get(empId) ?? [];
      const empReviews = reviewsByEmployee.get(empId) ?? [];
      const empTasks = tasksByEmployee.get(empId) ?? [];

      // ---- attendance risk
      const counted = empAttendance.filter((r) => ['present', 'late', 'half-day', 'absent', 'leave'].includes(r.status as string));
      const present = counted.filter((r) => r.status === 'present').length;
      const late = counted.filter((r) => r.status === 'late').length;
      const halfDay = counted.filter((r) => r.status === 'half-day').length;
      const absent = counted.filter((r) => r.status === 'absent').length;
      const leave = counted.filter((r) => r.status === 'leave').length;
      const attendanceRate = counted.length > 0 ? (present + late + halfDay * 0.5) / counted.length : null;

      let attendanceRisk: number | null = null;
      if (attendanceRate !== null && counted.length >= 5) {
        const rateRisk = (1 - attendanceRate) * 100;
        const latePenalty = (late / Math.max(1, counted.length)) * 15;
        const absencePenalty = Math.min(12, absent * 1.5);
        attendanceRisk = clampScore(rateRisk + latePenalty + absencePenalty);
      }

      // ---- performance risk
      const latestReview = empReviews[0];
      const previousReview = empReviews[1];
      const latestScore = latestReview?.performance_score as number | null | undefined;
      const prevScore = previousReview?.performance_score as number | null | undefined;
      const trend = latestScore != null && prevScore != null ? Number(latestScore) - Number(prevScore) : null;

      let performanceRisk: number | null = null;
      if (latestScore != null) {
        const levelRisk = 100 - Number(latestScore);
        const trendAdjust = trend != null ? trend * 1.5 : 0;
        performanceRisk = clampScore(levelRisk - trendAdjust);
      }

      // ---- task completion risk
      let taskRisk: number | null = null;
      if (empTasks.length > 0) {
        const completed = empTasks.filter((t) => t.status === 'completed').length;
        const blocked = empTasks.filter((t) => t.status === 'blocked').length;
        const todayIso = isoDate(now);
        const overdue = empTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && (t.due_date as string) < todayIso).length;
        const completionRate = completed / empTasks.length;
        taskRisk = clampScore((1 - completionRate) * 80 + blocked * 4 + overdue * 5);
      }

      // ---- combined risk (attendance 40%, performance 40%, task/goal trend 20%)
      const available = [attendanceRisk, performanceRisk, taskRisk].filter((v) => v !== null) as number[];
      let combinedRisk: number | null = null;
      if (available.length === 3) {
        combinedRisk = clampScore(
          attendanceRisk! * WEIGHTS.attendance + performanceRisk! * WEIGHTS.performance + taskRisk! * WEIGHTS.taskTrend,
        );
      } else if (available.length >= 1) {
        const sum = available.reduce((a, b) => a + b, 0);
        combinedRisk = clampScore((sum / available.length) * 0.85);
      }

      // ---- attrition risk
      let attritionRisk: number | null = null;
      {
        let score = 10;
        if (emp.status === 'notice period') score += 55;
        if (emp.status === 'on leave') score += 12;
        if (attendanceRate !== null && attendanceRate < 0.8) score += 15;
        if (trend != null && trend < -5) score += 12;
        if (taskRisk !== null && taskRisk > 60) score += 10;
        if (emp.employment_type === 'contract') score += 6;
        attritionRisk = clampScore(score);
      }

      const evidence = {
        window_days: 30,
        attendance_records: counted.length,
        attendance_rate: attendanceRate != null ? Math.round(attendanceRate * 1000) / 1000 : null,
        present, late, half_day: halfDay, absent, leave,
        latest_review_score: latestScore ?? null,
        previous_review_score: prevScore ?? null,
        performance_trend: trend != null ? Math.round(trend * 100) / 100 : null,
        review_status: latestReview?.status ?? null,
        tasks_total: empTasks.length,
        tasks_completed: empTasks.filter((t) => t.status === 'completed').length,
        tasks_blocked: empTasks.filter((t) => t.status === 'blocked').length,
        employment_status: emp.status,
        formula_version: FORMULA_VERSION,
        weights: WEIGHTS,
      };

      const evidenceQuality =
        counted.length >= 15 && latestReview ? 'strong'
          : counted.length >= 5 || latestReview ? 'moderate'
            : counted.length > 0 || empTasks.length > 0 ? 'limited'
              : 'insufficient';

      const limitations =
        evidenceQuality === 'strong'
          ? null
          : 'Evidence is partial for the current 30-day window; treat the score as directional.';

      const push = (type: string, score: number | null, explanation: string, recommendation: string) => {
        if (score === null) return;
        signalRows.push({
          entity_type: 'employee',
          entity_id: empId,
          signal_type: type,
          score,
          severity: severityFor(score),
          formula_version: FORMULA_VERSION,
          evidence: { ...evidence, metric: type },
          explanation,
          evidence_quality: evidenceQuality,
          limitations,
          recommendation,
          status: 'new',
          detected_at: now.toISOString(),
        });
      };

      const rateText = attendanceRate != null ? `${Math.round(attendanceRate * 100)}%` : 'n/a';

      push(
        'attendance_risk',
        attendanceRisk,
        `Attendance rate over the last 30 days is ${rateText} across ${counted.length} recorded days, with ${late} late check-ins and ${absent} absences.`,
        attendanceRisk != null && attendanceRisk >= 60
          ? 'Schedule a 1:1 to understand attendance drivers and agree a recovery plan.'
          : 'Continue routine monitoring; no intervention required while the rate holds.',
      );

      push(
        'performance_risk',
        performanceRisk,
        latestScore != null
          ? `Latest performance score is ${latestScore}${trend != null ? ` (${trend >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(trend * 100) / 100)} points versus the prior period)` : ''}.`
          : 'No submitted performance review is available for this employee.',
        performanceRisk != null && performanceRisk >= 60
          ? 'Open a performance review cycle and agree measurable goals for the next period.'
          : 'Keep the current review cadence.',
      );

      push(
        'task_completion_risk',
        taskRisk,
        empTasks.length > 0
          ? `${empTasks.filter((t) => t.status === 'completed').length} of ${empTasks.length} tracked tasks are complete, with ${empTasks.filter((t) => t.status === 'blocked').length} blocked.`
          : 'No tracked tasks are assigned to this employee.',
        taskRisk != null && taskRisk >= 60
          ? 'Review the blocked backlog with the employee and rebalance workload.'
          : 'Maintain the current task cadence.',
      );

      push(
        'combined_risk',
        combinedRisk,
        combinedRisk != null
          ? `Combined signal blends attendance (40%), performance (40%) and task/goal trend (20%) into a score of ${combinedRisk}.`
          : 'Combined signal could not be produced.',
        combinedRisk != null && combinedRisk >= 60
          ? 'Create a tracked action and assign an owner with a due date.'
          : 'No action needed at this severity.',
      );

      push(
        'attrition_risk',
        attritionRisk,
        `Employment status is "${emp.status}" with a ${rateText} attendance rate over the last 30 days.`,
        attritionRisk != null && attritionRisk >= 60
          ? 'Run a stay conversation and review recognition and growth options.'
          : 'Monitor through the regular engagement cycle.',
      );

      employeeMetrics.push({ employee: emp, attendanceRate, latestScore, trend, combinedRisk, attendanceRisk, performanceRisk, taskRisk, attritionRisk });
    }

    // ---- department-level signals
    const departmentAggregates: Array<Record<string, unknown>> = [];
    for (const dept of departments) {
      const deptEmployees = activeEmployees.filter((e) => e.department_id === dept.id);
      if (deptEmployees.length === 0) continue;
      const ids = new Set(deptEmployees.map((e) => e.id as string));
      const deptAttendance = attendance.filter((a) => ids.has(a.employee_id as string) && (a.attendance_date as string) >= cutoffIso);
      const counted = deptAttendance.filter((r) => ['present', 'late', 'half-day', 'absent'].includes(r.status as string));
      const present = counted.filter((r) => r.status === 'present').length;
      const late = counted.filter((r) => r.status === 'late').length;
      const halfDay = counted.filter((r) => r.status === 'half-day').length;
      const deptRate = counted.length > 0 ? (present + late + halfDay * 0.5) / counted.length : null;

      const deptReviews = deptEmployees
        .map((e) => (reviewsByEmployee.get(e.id as string) ?? [])[0]?.performance_score as number | undefined)
        .filter((v): v is number => typeof v === 'number');
      const avgPerformance = deptReviews.length > 0 ? deptReviews.reduce((a, b) => a + b, 0) / deptReviews.length : null;

      const deptTasks = tasks.filter((t) => ids.has(t.employee_id as string));
      const taskCompletion = deptTasks.length > 0 ? deptTasks.filter((t) => t.status === 'completed').length / deptTasks.length : null;

      const deptMetrics = employeeMetrics.filter((m) => (m.employee as Record<string, unknown>).department_id === dept.id);
      const highRiskCount = deptMetrics.filter((m) => (m.combinedRisk as number | null) != null && (m.combinedRisk as number) >= 60).length;
      const avgCombined = deptMetrics.filter((m) => m.combinedRisk != null);
      const deptCombined = avgCombined.length > 0
        ? avgCombined.reduce((a, m) => a + (m.combinedRisk as number), 0) / avgCombined.length
        : null;

      const highRiskShare = deptEmployees.length > 0 ? highRiskCount / deptEmployees.length : 0;
      const attendanceRisk = deptRate != null
        ? clampScore((1 - deptRate) * 150 + (late / Math.max(1, counted.length)) * 15 + highRiskShare * 45)
        : null;
      const performanceRisk = avgPerformance != null ? clampScore(100 - avgPerformance) : null;
      const taskRisk = taskCompletion != null ? clampScore((1 - taskCompletion) * 100) : null;
      // A department needs attention when a concentrated share of its people are at
      // risk, not only when its average dips — blend the pooled score with the band share.
      const mediumRiskCount = deptMetrics.filter((m) => {
        const v = m.combinedRisk as number | null;
        return v != null && v >= 35 && v < 60;
      }).length;
      const mediumRiskShare = deptEmployees.length > 0 ? mediumRiskCount / deptEmployees.length : 0;
      const bandScore = highRiskShare * 100 + mediumRiskShare * 50;
      const pooledCombined =
        attendanceRisk != null && performanceRisk != null && taskRisk != null
          ? attendanceRisk * WEIGHTS.attendance + performanceRisk * WEIGHTS.performance + taskRisk * WEIGHTS.taskTrend
          : deptCombined;
      const combined = pooledCombined != null ? clampScore(pooledCombined * 0.5 + bandScore * 0.5) : null;

      const deptEvidence = {
        headcount: deptEmployees.length,
        attendance_rate: deptRate != null ? Math.round(deptRate * 1000) / 1000 : null,
        late_count: late,
        absence_count: counted.filter((r) => r.status === 'absent').length,
        average_performance: avgPerformance != null ? Math.round(avgPerformance * 100) / 100 : null,
        task_completion_rate: taskCompletion != null ? Math.round(taskCompletion * 1000) / 1000 : null,
        employees_high_risk: highRiskCount,
        window_days: 30,
        formula_version: FORMULA_VERSION,
        weights: WEIGHTS,
      };

      const pushDept = (type: string, score: number | null, explanation: string, recommendation: string) => {
        if (score === null) return;
        signalRows.push({
          entity_type: 'department',
          entity_id: dept.id,
          signal_type: type,
          score,
          severity: severityFor(score),
          formula_version: FORMULA_VERSION,
          evidence: { ...deptEvidence, metric: type },
          explanation,
          evidence_quality: counted.length >= 50 ? 'strong' : counted.length >= 15 ? 'moderate' : 'limited',
          limitations: counted.length >= 50 ? null : 'Department window is thin; interpret against headcount.',
          recommendation,
          status: 'new',
          detected_at: now.toISOString(),
        });
      };

      pushDept(
        'attendance_risk',
        attendanceRisk,
        `Department attendance rate is ${deptRate != null ? Math.round(deptRate * 100) : 'n/a'}% across ${counted.length} records (${late} late check-ins).`,
        attendanceRisk != null && attendanceRisk >= 60 ? 'Review shift patterns and workload distribution for this department.' : 'No department-level attendance intervention required.',
      );
      pushDept(
        'performance_risk',
        performanceRisk,
        avgPerformance != null ? `Average performance score is ${Math.round(avgPerformance * 100) / 100} with ${highRiskCount} employees above the high-risk threshold.` : 'No submitted reviews are available for this department.',
        performanceRisk != null && performanceRisk >= 60 ? 'Run a department calibration session and align goals.' : 'Maintain the current review cadence.',
      );
      pushDept(
        'task_completion_risk',
        taskRisk,
        taskCompletion != null ? `${Math.round(taskCompletion * 100)}% of department tasks are complete (${deptTasks.length} tracked).` : 'No tracked tasks for this department.',
        taskRisk != null && taskRisk >= 60 ? 'Triage blocked work and rebalance ownership.' : 'No task-level intervention required.',
      );
      pushDept(
        'combined_risk',
        combined,
        combined != null ? `Combined department signal blends attendance (40%), performance (40%) and task trend (20%) into ${combined}.` : 'Combined department signal could not be produced.',
        combined != null && combined >= 60 ? 'Raise a department-level action with an executive summary.' : 'Continue monitoring.',
      );

      departmentAggregates.push({ dept, deptRate, avgPerformance, taskCompletion, highRiskCount, combined, headcount: deptEmployees.length });
    }

    // ---- recruitment capacity risk (per department)
    for (const dept of departments) {
      const deptReqs = requisitions.filter((r) => r.department_id === dept.id && r.status === 'open');
      if (deptReqs.length === 0) continue;
      const reqIds = new Set(deptReqs.map((r) => r.id as string));
      const openings = deptReqs.reduce((a, r) => a + Number(r.openings ?? 0), 0);
      const pipeline = candidates.filter((c) => reqIds.has(c.requisition_id as string) && ['applied', 'screening', 'interview'].includes(c.current_stage as string) && c.status === 'active').length;
      const readyToOffer = candidates.filter((c) => reqIds.has(c.requisition_id as string) && ['internship', 'full_time_offer'].includes(c.current_stage as string)).length;

      const capacityRisk = clampScore(Math.max(0, (openings * 3 - pipeline - readyToOffer * 2) / (openings * 3)) * 100);

      signalRows.push({
        entity_type: 'department',
        entity_id: dept.id,
        signal_type: 'recruitment_capacity_risk',
        score: capacityRisk,
        severity: severityFor(capacityRisk),
        formula_version: FORMULA_VERSION,
        evidence: {
          open_requisitions: deptReqs.length,
          total_openings: openings,
          active_pipeline: pipeline,
          late_stage_candidates: readyToOffer,
          metric: 'recruitment_capacity_risk',
          formula_version: FORMULA_VERSION,
        },
        explanation: `${openings} open positions against ${pipeline} active candidates earlier in the pipeline.`,
        evidence_quality: 'moderate',
        limitations: 'Pipeline depth changes daily; rerun after each requisition update.',
        recommendation: capacityRisk >= 60
          ? 'Increase sourcing capacity or narrow the requirement to fill the role faster.'
          : 'Pipeline depth is adequate for the current openings.',
        status: 'new',
        detected_at: now.toISOString(),
      });
    }

    // ---- persist signals (idempotent per entity/type/version)
    for (let i = 0; i < signalRows.length; i += 400) {
      const slice = signalRows.slice(i, i + 400);
      const { error } = await admin
        .from('hr_signals')
        .upsert(slice, { onConflict: 'entity_type,entity_id,signal_type,formula_version', ignoreDuplicates: false });
      if (error) throw new Error(`hr_signals: ${error.message}`);
    }

    // ---- organisation insights (deterministic, evidence-backed)
    const { data: existingInsights } = await admin.from('hr_ai_insights').select('title');
    const existingTitles = new Set((existingInsights ?? []).map((i) => i.title as string));

    const orgAttendanceRates = employeeMetrics
      .filter((m) => m.attendanceRate != null)
      .map((m) => ({ employee: m.employee as Record<string, unknown>, rate: m.attendanceRate as number }));
    orgAttendanceRates.sort((a, b) => a.rate - b.rate);

    if (orgAttendanceRates.length > 0) {
      const worst = orgAttendanceRates.slice(0, 5);
      const title = 'Lowest attendance rates across the organisation';
      if (!existingTitles.has(title)) {
        insights.push({
          scope: 'organization',
          entity_type: null,
          entity_id: null,
          category: 'attendance',
          title,
          summary: `${worst.length} employees sit below the organisation median attendance rate over the last 30 days, the lowest being ${worst[0].employee.full_name} at ${Math.round(worst[0].rate * 100)}%.`,
          verified_evidence: { window_days: 30, employees: worst.map((w) => ({ id: w.employee.id, name: w.employee.full_name, rate: Math.round(w.rate * 1000) / 1000 })) },
          limitations: 'Attendance is imported periodically; the window reflects the most recent upload.',
          recommendation: 'Review the attendance drivers for the listed employees and agree individual recovery plans.',
          confidence: 'strong',
        });
      }
    }

    const deptRates = departmentAggregates
      .filter((d) => d.deptRate != null)
      .map((d) => ({ name: (d.dept as Record<string, unknown>).name as string, rate: d.deptRate as number }));
    deptRates.sort((a, b) => a.rate - b.rate);
    if (deptRates.length > 0) {
      const title = 'Department attendance comparison';
      if (!existingTitles.has(title)) {
        insights.push({
          scope: 'organization',
          entity_type: null,
          entity_id: null,
          category: 'attendance',
          title,
          summary: `${deptRates[0].name} has the lowest department attendance at ${Math.round(deptRates[0].rate * 100)}%, against the highest at ${Math.round(deptRates[deptRates.length - 1].rate * 100)}% (${deptRates[deptRates.length - 1].name}).`,
          verified_evidence: { window_days: 30, departments: deptRates.map((d) => ({ name: d.name, rate: Math.round(d.rate * 1000) / 1000 })) },
          limitations: 'Department figures are unweighted averages of recorded days.',
          recommendation: 'Share the comparison with department leads and confirm the review cadence.',
          confidence: 'strong',
        });
      }
    }

    const highRisk = employeeMetrics.filter((m) => m.combinedRisk != null && (m.combinedRisk as number) >= 60);
    if (highRisk.length > 0) {
      const title = 'Employees above the combined-risk threshold';
      if (!existingTitles.has(title)) {
        insights.push({
          scope: 'organization',
          entity_type: null,
          entity_id: null,
          category: 'risk',
          title,
          summary: `${highRisk.length} employees score 60 or above on combined risk (attendance 40%, performance 40%, task/goal trend 20%).`,
          verified_evidence: { threshold: 60, formula_version: FORMULA_VERSION, employees: highRisk.slice(0, 20).map((m) => ({ id: (m.employee as Record<string, unknown>).id, name: (m.employee as Record<string, unknown>).full_name, score: m.combinedRisk })) },
          limitations: 'Combined risk is a prioritisation signal, not a decision or a performance judgement.',
          recommendation: 'Assign owners to the highest scoring employees and track actions to resolution.',
          confidence: 'strong',
        });
      }
    }

    const pendingReview = employeeMetrics.filter((m) => m.latestScore == null);
    if (pendingReview.length > 0) {
      const title = 'Employees without a submitted performance review';
      if (!existingTitles.has(title)) {
        insights.push({
          scope: 'organization',
          entity_type: null,
          entity_id: null,
          category: 'performance',
          title,
          summary: `${pendingReview.length} active employees have no submitted performance review, so their performance risk cannot be evidenced.`,
          verified_evidence: { employees: pendingReview.slice(0, 20).map((m) => ({ id: (m.employee as Record<string, unknown>).id, name: (m.employee as Record<string, unknown>).full_name })) },
          limitations: 'Absence of a review is a process gap, not evidence of poor performance.',
          recommendation: 'Complete the outstanding performance reviews before drawing performance conclusions.',
          confidence: 'moderate',
        });
      }
    }

    const stalePipeline = departmentAggregates
      .map((d) => ({ name: (d.dept as Record<string, unknown>).name as string, headcount: d.headcount, capacity: (d.dept as Record<string, unknown>).capacity as number | null }))
      .filter((d) => d.capacity != null && d.headcount > d.capacity);
    if (stalePipeline.length > 0) {
      const title = 'Departments above planned capacity';
      if (!existingTitles.has(title)) {
        insights.push({
          scope: 'organization',
          entity_type: null,
          entity_id: null,
          category: 'capacity',
          title,
          summary: `${stalePipeline.map((d) => d.name).join(', ')} exceed planned headcount capacity.`,
          verified_evidence: { departments: stalePipeline },
          limitations: 'Capacity is a planning figure maintained by HR.',
          recommendation: 'Rebalance headcount or raise the approved capacity for the affected departments.',
          confidence: 'moderate',
        });
      }
    }

    if (insights.length > 0) {
      const { error } = await admin.from('hr_ai_insights').insert(insights);
      if (error) throw new Error(`hr_ai_insights: ${error.message}`);
    }

    return json({
      ok: true,
      formula_version: FORMULA_VERSION,
      weights: WEIGHTS,
      signals: signalRows.length,
      insights: insights.length,
      employees_evaluated: activeEmployees.length,
    });
  } catch (error) {
    console.error('risk-engine failed', error);
    return json({ ok: false, reason: 'engine_failed', message: String(error) }, 500);
  }
});
