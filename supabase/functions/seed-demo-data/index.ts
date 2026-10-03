// HR Signal AI :: deterministic, idempotent demo data seeder.
// Business data only — risk signals and insights are produced by the risk-engine function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Deterministic PRNG so repeated runs on a fresh database produce the same workforce.
function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Aiko', 'Alice', 'Amara', 'Ana', 'Andre', 'Anika', 'Arjun', 'Beatriz',
  'Bruno', 'Camila', 'Carlos', 'Chen', 'Chloe', 'Daniel', 'Diego', 'Divya', 'Elena', 'Emeka',
  'Emma', 'Ethan', 'Fatima', 'Felix', 'Gabriel', 'Grace', 'Hana', 'Hassan', 'Ibrahim', 'Iris',
  'Isabella', 'Ivan', 'Jae', 'James', 'Jasmine', 'Jonas', 'Julia', 'Kabir', 'Kai', 'Karim',
  'Laila', 'Laura', 'Leo', 'Liam', 'Lina', 'Lucas', 'Maya', 'Mei', 'Mia', 'Miguel',
  'Nadia', 'Naomi', 'Nikhil', 'Noah', 'Olivia', 'Omar', 'Priya', 'Rafael', 'Rania', 'Ravi',
  'Riya', 'Rosa', 'Sakura', 'Samuel', 'Sara', 'Sebastian', 'Sofia', 'Sora', 'Tariq', 'Theo',
  'Tomas', 'Uma', 'Valentina', 'Victor', 'Wei', 'Yara', 'Yusuf', 'Zainab', 'Zara', 'Zoe',
];

const LAST_NAMES = [
  'Adeyemi', 'Ahmed', 'Anderson', 'Bakshi', 'Bennett', 'Brooks', 'Castillo', 'Chandra', 'Chen', 'Costa',
  'Das', 'Delgado', 'Diallo', 'Dubois', 'Fernandez', 'Fischer', 'Garcia', 'Gupta', 'Haddad', 'Hansen',
  'Hernandez', 'Ibrahim', 'Iyer', 'Jensen', 'Kapoor', 'Kaur', 'Keller', 'Khan', 'Kim', 'Kumar',
  'Larsen', 'Lee', 'Liu', 'Lopez', 'Martin', 'Mbeki', 'Mehta', 'Meyer', 'Mishra', 'Moreau',
  'Nakamura', 'Nguyen', 'Novak', 'Okafor', 'Olsen', 'Park', 'Patel', 'Petrov', 'Rahman', 'Reddy',
  'Rossi', 'Sato', 'Schmidt', 'Sharma', 'Silva', 'Singh', 'Sorensen', 'Tanaka', 'Thompson', 'Torres',
  'Vargas', 'Verma', 'Wang', 'Weber', 'Yamamoto', 'Zhang', 'Zimmerman', 'Okonkwo', 'Reyes', 'Bhatt',
];

const DEPARTMENTS = [
  { code: 'ENG', name: 'Engineering', description: 'Platform, product engineering and infrastructure.', capacity: 60, titles: ['Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'QA Engineer', 'DevOps Engineer', 'Engineering Manager'] },
  { code: 'PRD', name: 'Product', description: 'Product management, design and research.', capacity: 24, titles: ['Product Manager', 'Senior Product Manager', 'Product Designer', 'UX Researcher'] },
  { code: 'MKT', name: 'Marketing', description: 'Brand, demand generation and content.', capacity: 22, titles: ['Marketing Specialist', 'Content Strategist', 'Growth Manager', 'Brand Manager'] },
  { code: 'SLS', name: 'Sales', description: 'Enterprise and mid-market revenue.', capacity: 30, titles: ['Account Executive', 'Sales Development Rep', 'Solutions Consultant', 'Sales Manager'] },
  { code: 'FIN', name: 'Finance', description: 'Controlling, payroll and financial planning.', capacity: 16, titles: ['Financial Analyst', 'Accountant', 'FP&A Manager'] },
  { code: 'OPS', name: 'Operations', description: 'Workplace, IT operations and support.', capacity: 20, titles: ['Operations Associate', 'IT Support Specialist', 'Workplace Manager'] },
  { code: 'HR', name: 'People/HR', description: 'People operations, recruiting and culture.', capacity: 14, titles: ['HR Business Partner', 'Talent Acquisition Specialist', 'People Operations Analyst'] },
];

const LOCATIONS = ['Bengaluru', 'London', 'Austin', 'Singapore', 'Berlin', 'Remote - India', 'Remote - US'];
const WORK_MODES = ['onsite', 'remote', 'hybrid'] as const;
const EMPLOYMENT_TYPES = ['full-time', 'full-time', 'full-time', 'full-time', 'contract', 'contract', 'part-time', 'intern'] as const;
const SKILLS_POOL = [
  'TypeScript', 'React', 'PostgreSQL', 'Data Analysis', 'Stakeholder Management', 'Forecasting',
  'Figma', 'Recruiting', 'Negotiation', 'SQL', 'Automation', 'Coaching', 'Reporting', 'Compliance',
];

type Row = Record<string, unknown>;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function workdaysBack(count: number) {
  const days: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (days.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.reverse();
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey) return json({ ok: false, reason: 'backend_not_configured' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // Authorization: an authenticated HR/founder may always re-run; an anonymous
    // caller may only bootstrap a completely empty database.
    const authHeader = req.headers.get('Authorization') ?? '';
    let callerRole: string | null = null;
    if (authHeader && anonKey) {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user?.id) {
        const { data: profile } = await admin
          .from('hr_profiles')
          .select('role, is_active')
          .eq('user_id', userData.user.id)
          .maybeSingle();
        if (profile?.is_active) callerRole = profile.role as string;
      }
    }

    // Seeding writes workforce data, so it is restricted to an authenticated HR
    // user. There is no anonymous bootstrap path — the database is never filled
    // by an unauthenticated caller.
    if (!callerRole) return json({ ok: false, reason: 'unauthenticated' }, 401);
    if (callerRole !== 'hr') {
      return json(
        { ok: false, reason: 'forbidden', message: 'Seeding sample workforce data is restricted to the HR role.' },
        403,
      );
    }

    const { count: existingEmployees } = await admin
      .from('hr_employees')
      .select('id', { count: 'exact', head: true });

    const alreadySeeded = (existingEmployees ?? 0) > 0;
    if (alreadySeeded) {
      return json({ ok: true, seeded: false, reason: 'already_seeded', employees: existingEmployees });
    }

    const rand = mulberry32(20260917);
    const now = new Date();

    // ---------------------------------------------------------------- departments
    const departmentRows = DEPARTMENTS.map((d) => ({
      code: d.code,
      name: d.name,
      description: d.description,
      capacity: d.capacity,
      is_active: true,
    }));
    const { data: insertedDepartments, error: depError } = await admin
      .from('hr_departments')
      .insert(departmentRows)
      .select('id, code, name');
    if (depError) throw depError;
    const departmentByCode = new Map((insertedDepartments ?? []).map((d) => [d.code, d]));

    // ---------------------------------------------------------------- employees
    const employeeRows: Row[] = [];
    const headRows: Row[] = [];
    const totalSeedEmployees = 150;
    const perDepartment = [42, 20, 18, 24, 12, 16, 18]; // sums to 150

    const lowAttendanceCodes = new Set<string>();
    const decliningCodes = new Set<string>();
    let codeCounter = 1000;

    DEPARTMENTS.forEach((dept, deptIndex) => {
      const count = perDepartment[deptIndex];
      for (let i = 0; i < count; i += 1) {
        codeCounter += 1;
        const code = `HRS-${codeCounter}`;
        const fullName = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;
        const employmentType = i === 0 ? 'full-time' : pick(rand, EMPLOYMENT_TYPES);
        const isIntern = employmentType === 'intern';

        let status: string = 'active';
        const roll = rand();
        if (roll < 0.075) status = 'exited';
        else if (roll < 0.105) status = 'notice period';
        else if (roll < 0.135) status = 'on leave';

        const joiningOffsetDays = isIntern ? 60 + Math.floor(rand() * 90) : 200 + Math.floor(rand() * 1600);
        const joining = new Date(now);
        joining.setUTCDate(joining.getUTCDate() - joiningOffsetDays);

        let exitDate: string | null = null;
        if (status === 'exited') {
          const exit = new Date(now);
          exit.setUTCDate(exit.getUTCDate() - (10 + Math.floor(rand() * 340)));
          exitDate = isoDate(exit);
        }

        // At-risk cohort is concentrated by department so department health visibly differs.
        const riskRate = dept.code === 'OPS' ? 0.45 : dept.code === 'SLS' ? 0.34 : dept.code === 'MKT' ? 0.22 : 0.07;
        if (i > 0 && rand() < riskRate) {
          lowAttendanceCodes.add(code);
          decliningCodes.add(code);
        }

        const skillCount = 2 + Math.floor(rand() * 3);
        const skills = Array.from({ length: skillCount }, () => pick(rand, SKILLS_POOL));

        const row: Row = {
          code,
          full_name: fullName,
          work_email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}.${codeCounter}@hrsignal.demo`,
          personal_email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}${codeCounter}@example.com`,
          phone: `+1-555-${String(1000 + Math.floor(rand() * 8999))}`,
          department_id: departmentByCode.get(dept.code)?.id ?? null,
          job_title: isIntern ? 'Intern' : pick(rand, dept.titles),
          employment_type: employmentType,
          work_mode: pick(rand, WORK_MODES),
          location: pick(rand, LOCATIONS),
          joining_date: isoDate(joining),
          exit_date: exitDate,
          status,
          skills,
        };
        if (i === 0) headRows.push(row);
        employeeRows.push(row);
      }
    });

    async function insertChunked(table: string, rows: Row[], size = 400, select?: string) {
      const out: Array<Record<string, unknown>> = [];
      for (let i = 0; i < rows.length; i += size) {
        const slice = rows.slice(i, i + size);
        const query = admin.from(table).insert(slice);
        const { data, error } = select ? await query.select(select) : await query;
        if (error) throw new Error(`${table}: ${error.message}`);
        if (data) out.push(...(data as Array<Record<string, unknown>>));
      }
      return out;
    }

    const insertedEmployees = await insertChunked('hr_employees', employeeRows, 300, 'id, code, full_name, department_id, status, employment_type, joining_date, exit_date, work_mode, location');
    if (insertedEmployees.length !== employeeRows.length) {
      throw new Error(`employee insert mismatch: ${insertedEmployees.length}/${employeeRows.length}`);
    }

    // Department heads: first employee inserted per department, then manager assignment.
    const headByDepartment = new Map<string, string>();
    for (const head of headRows) {
      const key = String(head.department_id);
      const match = insertedEmployees.find(
        (e) => e.department_id === head.department_id && e.full_name === head.full_name && !headByDepartment.has(key),
      );
      if (match) headByDepartment.set(key, match.id as string);
    }

    const managerUpdates = insertedEmployees
      .filter((e) => {
        const head = headByDepartment.get(String(e.department_id));
        return head && head !== e.id;
      })
      .map((e) => ({ id: e.id as string, manager_id: headByDepartment.get(String(e.department_id)) as string }));

    for (let i = 0; i < managerUpdates.length; i += 300) {
      const slice = managerUpdates.slice(i, i + 300);
      for (const item of slice) {
        const { error } = await admin.from('hr_employees').update({ manager_id: item.manager_id }).eq('id', item.id);
        if (error) throw error;
      }
    }

    await admin
      .from('hr_departments')
      .update({ head_employee_id: headByDepartment.get(String(departmentByCode.get('ENG')?.id)) ?? null })
      .eq('code', 'ENG');
    for (const dept of DEPARTMENTS) {
      const deptId = departmentByCode.get(dept.code)?.id;
      const head = headByDepartment.get(String(deptId));
      if (deptId && head) await admin.from('hr_departments').update({ head_employee_id: head }).eq('id', deptId);
    }

    // ---------------------------------------------------------------- attendance
    const attendanceDays = workdaysBack(64);
    const attendanceRows: Row[] = [];
    const lowCodes = lowAttendanceCodes;

    for (const emp of insertedEmployees) {
      if (emp.status === 'exited' && !emp.exit_date) continue;
      const joined = emp.joining_date as string | null;
      const exitedAt = emp.exit_date as string | null;
      for (const day of attendanceDays) {
        const dayIso = isoDate(day);
        if (joined && dayIso < joined) continue;
        if (exitedAt && dayIso > exitedAt) continue;
        if (emp.status === 'exited') continue;

        const code = emp.code as string;
        const lowPerformer = lowCodes.has(code);
        const roll = rand();
        let status: string;
        if (lowPerformer) {
          if (roll < 0.25) status = 'present';
          else if (roll < 0.35) status = 'late';
          else if (roll < 0.8) status = 'absent';
          else if (roll < 0.97) status = 'leave';
          else status = 'half-day';
        } else {
          if (roll < 0.93) status = 'present';
          else if (roll < 0.96) status = 'late';
          else if (roll < 0.985) status = 'absent';
          else if (roll < 0.998) status = 'leave';
          else status = 'half-day';
        }

        let checkIn: string | null = null;
        let checkOut: string | null = null;
        let workingMinutes: number | null = null;

        if (status === 'present' || status === 'late' || status === 'half-day') {
          const startHour = status === 'late' ? 10 : 9;
          const startMinute = status === 'late' ? 20 + Math.floor(rand() * 30) : Math.floor(rand() * 25);
          const inDate = new Date(`${dayIso}T00:00:00Z`);
          inDate.setUTCHours(startHour, startMinute, 0, 0);
          checkIn = inDate.toISOString();
          const duration = status === 'half-day' ? 240 : 470 + Math.floor(rand() * 80);
          workingMinutes = duration;
          const outDate = new Date(inDate.getTime() + duration * 60000);
          checkOut = outDate.toISOString();
        }

        attendanceRows.push({
          employee_id: emp.id,
          attendance_date: dayIso,
          check_in: checkIn,
          check_out: checkOut,
          working_minutes: workingMinutes,
          overtime_minutes: status === 'present' && workingMinutes && workingMinutes > 480 ? workingMinutes - 480 : 0,
          status,
          notes: null,
        });
      }
    }

    await insertChunked('hr_attendance', attendanceRows, 600, 'id');

    // ---------------------------------------------------------------- import history
    const { data: hrProfiles } = await admin.from('hr_profiles').select('user_id, role');
    const hrUserId = hrProfiles?.find((p) => p.role === 'hr')?.user_id ?? null;

    const importRows = [
      { file_name: 'attendance_2026_07_w1.csv', file_type: 'csv', status: 'confirmed', total_rows: 640, valid_rows: 631, invalid_rows: 5, duplicate_rows: 4, confirmed_at: new Date(now.getTime() - 20 * 86400000).toISOString(), uploaded_by: hrUserId },
      { file_name: 'attendance_2026_07_w2.xlsx', file_type: 'xlsx', status: 'confirmed', total_rows: 655, valid_rows: 648, invalid_rows: 3, duplicate_rows: 4, confirmed_at: new Date(now.getTime() - 13 * 86400000).toISOString(), uploaded_by: hrUserId },
      { file_name: 'biometric_export_aug.pdf', file_type: 'pdf', status: 'failed', total_rows: 0, valid_rows: 0, invalid_rows: 0, duplicate_rows: 0, failure_reason: 'Image-only PDF: no extractable text layer. Export CSV/XLSX or a text-based PDF.', uploaded_by: hrUserId },
    ];
    const { data: insertedImports, error: importError } = await admin.from('hr_attendance_imports').insert(importRows).select('id, status');
    if (importError) throw importError;

    // ---------------------------------------------------------------- tasks
    const taskTitles = [
      'Close sprint deliverables', 'Prepare quarterly business review', 'Update onboarding runbook',
      'Migrate reporting dashboard', 'Complete compliance training', 'Draft hiring scorecard',
      'Refactor authentication module', 'Publish release notes', 'Reconcile vendor invoices',
      'Review customer escalations', 'Run usability session', 'Refresh enablement deck',
    ];
    const taskRows: Row[] = [];
    for (const emp of insertedEmployees) {
      if (emp.status === 'exited') continue;
      const count = 2 + Math.floor(rand() * 5);
      const decliner = decliningCodes.has(emp.code as string);
      for (let i = 0; i < count; i += 1) {
        const roll = rand();
        let status = 'completed';
        if (decliner) {
          if (roll < 0.2) status = 'completed';
          else if (roll < 0.4) status = 'in_progress';
          else if (roll < 0.7) status = 'todo';
          else status = 'blocked';
        } else if (roll < 0.7) status = 'completed';
        else if (roll < 0.88) status = 'in_progress';
        else if (roll < 0.96) status = 'todo';
        else status = 'blocked';

        const due = new Date(now);
        due.setUTCDate(due.getUTCDate() + (status === 'completed' ? -Math.floor(rand() * 20) : Math.floor(rand() * 25) - 6));

        taskRows.push({
          employee_id: emp.id,
          department_id: emp.department_id,
          title: pick(rand, taskTitles),
          description: 'Tracked in the workforce action backlog.',
          assigned_by: hrUserId,
          due_date: isoDate(due),
          completed_date: status === 'completed' ? isoDate(due) : null,
          priority: pick(rand, ['low', 'medium', 'medium', 'high', 'critical']),
          status,
          completion_percent: status === 'completed' ? 100 : status === 'in_progress' ? 30 + Math.floor(rand() * 50) : status === 'blocked' ? 10 + Math.floor(rand() * 30) : 0,
        });
      }
    }
    await insertChunked('hr_tasks', taskRows, 500);

    // ---------------------------------------------------------------- performance reviews
    const reviewRows: Row[] = [];
    const previousPeriodStart = new Date(now); previousPeriodStart.setUTCDate(previousPeriodStart.getUTCDate() - 180);
    const previousPeriodEnd = new Date(now); previousPeriodEnd.setUTCDate(previousPeriodEnd.getUTCDate() - 90);
    const currentPeriodStart = new Date(now); currentPeriodStart.setUTCDate(currentPeriodStart.getUTCDate() - 89);
    const currentPeriodEnd = new Date(now);

    for (const emp of insertedEmployees) {
      if (emp.status === 'exited') continue;
      const decliner = decliningCodes.has(emp.code as string);
      const base = decliner ? 62 + Math.floor(rand() * 14) : 66 + Math.floor(rand() * 30);
      const previous = base + (decliner ? 8 + Math.floor(rand() * 8) : Math.floor(rand() * 8) - 3);
      const current = decliner ? base - (12 + Math.floor(rand() * 10)) : base + Math.floor(rand() * 6) - 2;

      const clamp = (n: number) => Math.max(28, Math.min(99, Math.round(n * 100) / 100));

      for (const [period, score] of [
        [{ start: previousPeriodStart, end: previousPeriodEnd }, previous],
        [{ start: currentPeriodStart, end: currentPeriodEnd }, current],
      ] as Array<[{ start: Date; end: Date }, number]>) {
        reviewRows.push({
          employee_id: emp.id,
          department_id: emp.department_id,
          reviewer_id: hrUserId,
          period_start: isoDate(period.start),
          period_end: isoDate(period.end),
          performance_score: clamp(score),
          goal_score: clamp(score + Math.floor(rand() * 10) - 5),
          task_score: clamp(score - 3 + Math.floor(rand() * 10)),
          manager_rating: Math.max(1, Math.min(5, Math.round(score / 20))),
          comments: decliner ? 'Delivery slipped this cycle; workload and clarity to be reviewed.' : 'Consistent delivery against agreed goals.',
          status: period.end.getTime() < now.getTime() - 30 * 86400000 ? 'closed' : 'submitted',
        });
      }
    }
    await insertChunked('hr_performance_reviews', reviewRows, 400);

    // ---------------------------------------------------------------- recruitment
    const requisitionRows = [
      { department: 'ENG', job_title: 'Senior Backend Engineer', employment_type: 'full-time', openings: 3, status: 'open', target_close_date: isoDate(new Date(now.getTime() + 45 * 86400000)) },
      { department: 'ENG', job_title: 'Site Reliability Engineer', employment_type: 'full-time', openings: 1, status: 'open', target_close_date: isoDate(new Date(now.getTime() + 30 * 86400000)) },
      { department: 'PRD', job_title: 'Product Designer', employment_type: 'full-time', openings: 2, status: 'open', target_close_date: isoDate(new Date(now.getTime() + 50 * 86400000)) },
      { department: 'SLS', job_title: 'Enterprise Account Executive', employment_type: 'full-time', openings: 4, status: 'open', target_close_date: isoDate(new Date(now.getTime() + 60 * 86400000)) },
      { department: 'MKT', job_title: 'Growth Marketing Manager', employment_type: 'full-time', openings: 1, status: 'on_hold', target_close_date: isoDate(new Date(now.getTime() + 70 * 86400000)) },
      { department: 'OPS', job_title: 'IT Support Specialist', employment_type: 'contract', openings: 1, status: 'open', target_close_date: isoDate(new Date(now.getTime() + 25 * 86400000)) },
      { department: 'HR', job_title: 'Talent Acquisition Partner', employment_type: 'full-time', openings: 2, status: 'open', target_close_date: isoDate(new Date(now.getTime() + 40 * 86400000)) },
      { department: 'FIN', job_title: 'Financial Analyst', employment_type: 'full-time', openings: 1, status: 'closed', target_close_date: isoDate(new Date(now.getTime() - 10 * 86400000)) },
    ].map((r) => ({
      department_id: departmentByCode.get(r.department)?.id ?? null,
      job_title: r.job_title,
      description: `${r.job_title} for the ${r.department} team.`,
      employment_type: r.employment_type,
      openings: r.openings,
      recruiter_id: hrUserId,
      status: r.status,
      open_date: isoDate(new Date(now.getTime() - 40 * 86400000)),
      target_close_date: r.target_close_date,
      close_date: r.status === 'closed' ? isoDate(new Date(now.getTime() - 5 * 86400000)) : null,
    }));

    const { data: insertedRequisitions, error: reqError } = await admin
      .from('hr_job_requisitions')
      .insert(requisitionRows)
      .select('id, job_title, department_id, status');
    if (reqError) throw reqError;

    const stages = ['applied', 'screening', 'interview', 'internship', 'full_time_offer', 'hired'] as const;
    const stageWeights = [0.3, 0.22, 0.2, 0.1, 0.08, 0.1];
    const candidateRows: Row[] = [];
    const openRequisitions = (insertedRequisitions ?? []).filter((r) => r.status !== 'closed');

    let candidateIndex = 0;
    for (const req of openRequisitions) {
      const count = 6 + Math.floor(rand() * 5);
      for (let i = 0; i < count; i += 1) {
        candidateIndex += 1;
        const roll = rand();
        let cumulative = 0;
        let stage: string = 'applied';
        for (let s = 0; s < stages.length; s += 1) {
          cumulative += stageWeights[s];
          if (roll <= cumulative) { stage = stages[s]; break; }
        }
        const statusRoll = rand();
        let status = 'active';
        if (statusRoll < 0.12) status = 'rejected';
        else if (statusRoll < 0.17) status = 'withdrawn';
        else if (statusRoll < 0.2) status = 'on_hold';
        else if (statusRoll < 0.23 && stage === 'full_time_offer') status = 'offer_declined';
        else if (statusRoll < 0.26 && stage === 'internship') status = 'internship_completed_not_converted';

        const name = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;
        const applied = new Date(now);
        applied.setUTCDate(applied.getUTCDate() - (5 + Math.floor(rand() * 60)));

        candidateRows.push({
          requisition_id: req.id,
          full_name: name,
          email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${candidateIndex}@example.com`,
          phone: `+1-555-${String(2000 + Math.floor(rand() * 7999))}`,
          source: pick(rand, ['Referral', 'LinkedIn', 'Career Site', 'Agency', 'Campus']),
          current_stage: stage,
          status,
          applied_date: isoDate(applied),
          recruiter_id: hrUserId,
          rating: status === 'rejected' ? 1 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 3),
          notes: null,
        });
      }
    }

    const insertedCandidates = await insertChunked('hr_candidates', candidateRows, 300, 'id, full_name, current_stage, status, requisition_id');
    const candidateByName = new Map(insertedCandidates.map((c) => [c.full_name as string, c]));

    // ---------------------------------------------------------------- interviews
    const interviewRows: Row[] = [];
    for (const candidate of insertedCandidates) {
      const stage = candidate.current_stage as string;
      if (stage === 'applied') continue;
      const count = stage === 'screening' ? 1 : 2 + Math.floor(rand() * 2);
      for (let i = 0; i < count; i += 1) {
        const scheduled = new Date(now);
        scheduled.setUTCDate(scheduled.getUTCDate() - (2 + Math.floor(rand() * 30)));
        scheduled.setUTCHours(10 + Math.floor(rand() * 6), 0, 0, 0);
        const completed = rand() < 0.75;
        interviewRows.push({
          candidate_id: candidate.id,
          interview_type: pick(rand, ['screening', 'technical', 'managerial', 'hr', 'panel', 'final']),
          interviewer_id: hrUserId,
          scheduled_at: scheduled.toISOString(),
          completed_at: completed ? new Date(scheduled.getTime() + 3600000).toISOString() : null,
          rating: completed ? 3 + Math.floor(rand() * 3) : null,
          feedback: completed ? 'Structured interview completed; notes captured in the candidate record.' : null,
          recommendation: completed ? pick(rand, ['strong_hire', 'hire', 'hold']) : null,
          status: completed ? 'completed' : 'scheduled',
        });
      }
    }
    await insertChunked('hr_interviews', interviewRows, 400);

    // ---------------------------------------------------------------- internships (candidate -> intern employee)
    const internshipCandidates = insertedCandidates.filter((c) => c.current_stage === 'internship' || c.current_stage === 'full_time_offer' || c.current_stage === 'hired');
    const internEmployeeRows: Row[] = internshipCandidates.slice(0, 6).map((c, idx) => {
      const name = c.full_name as string;
      const joining = new Date(now);
      joining.setUTCDate(joining.getUTCDate() - (30 + idx * 9));
      return {
        code: `HRS-INT-${2000 + idx}`,
        full_name: name,
        work_email: `intern.${name.toLowerCase().replace(/[^a-z]+/g, '.')}@hrsignal.demo`,
        personal_email: `intern${idx}@example.com`,
        department_id: departmentByCode.get('ENG')?.id ?? null,
        job_title: 'Intern',
        employment_type: 'intern',
        work_mode: 'onsite',
        location: 'Bengaluru',
        joining_date: isoDate(joining),
        status: 'active',
        skills: ['TypeScript', 'React'],
      };
    });
    const insertedInterns = await insertChunked('hr_employees', internEmployeeRows, 200, 'id, full_name');

    const internshipRows: Row[] = [];
    internshipCandidates.slice(0, 6).forEach((candidate, idx) => {
      const intern = insertedInterns[idx];
      if (!intern) return;
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - (30 + idx * 9));
      const plannedEnd = new Date(start);
      plannedEnd.setUTCDate(plannedEnd.getUTCDate() + 180);
      const completed = candidate.current_stage === 'hired';
      internshipRows.push({
        candidate_id: candidate.id,
        employee_id: intern.id,
        department_id: departmentByCode.get('ENG')?.id ?? null,
        start_date: isoDate(start),
        planned_end_date: isoDate(plannedEnd),
        actual_end_date: completed ? isoDate(new Date(now.getTime() - 5 * 86400000)) : null,
        supervisor_id: hrUserId,
        status: completed ? 'converted' : 'active',
        evaluation: completed ? 'Strong delivery during the internship; converted to full-time.' : 'On track against the internship plan.',
        conversion_decision: completed ? 'convert' : 'pending',
      });
      const target = candidateByName.get(candidate.full_name as string);
      if (target) {
        // link candidate -> employee (never a duplicate employee record)
        admin.from('hr_candidates').update({ linked_employee_id: intern.id }).eq('id', candidate.id).then(() => {});
      }
    });
    await insertChunked('hr_internships', internshipRows, 200);

    // Converted interns become full-time on the same employee record.
    const convertedInternIds = internshipRows.filter((r) => r.status === 'converted').map((r) => r.employee_id as string);
    for (const id of convertedInternIds) {
      await admin.from('hr_employees').update({ employment_type: 'full-time', job_title: 'Software Engineer' }).eq('id', id);
    }

    // ---------------------------------------------------------------- actions & approvals
    const engDeptId = departmentByCode.get('ENG')?.id;
    const actionRows = [
      { title: 'Run structured review for the Engineering attendance dip', description: 'Engineering attendance fell below the org median over the last 30 days.', source_type: 'signal', priority: 'high', status: 'in_progress', sensitivity: 'routine', approval_required: false, due_date: isoDate(new Date(now.getTime() + 7 * 86400000)) },
      { title: 'Approve headcount backfill for SRE role', description: 'Backfill requested after a resignation on the platform team.', source_type: 'manual', priority: 'critical', status: 'approval_required', sensitivity: 'sensitive', approval_required: true, due_date: isoDate(new Date(now.getTime() + 10 * 86400000)) },
      { title: 'Approve probation confirmation for intern conversion', description: 'Convert completed internship to full-time employment.', source_type: 'candidate_conversion', priority: 'high', status: 'approval_required', sensitivity: 'sensitive', approval_required: true, due_date: isoDate(new Date(now.getTime() + 14 * 86400000)) },
      { title: 'Publish corrected attendance import', description: 'Five rows failed validation in the July week 2 import.', source_type: 'attendance_import', priority: 'medium', status: 'resolved', sensitivity: 'routine', approval_required: false, due_date: isoDate(new Date(now.getTime() - 3 * 86400000)), resolution_notes: 'Invalid employee codes corrected and rows re-confirmed.' },
      { title: 'Approve restructure of the Sales territory plan', description: 'Proposed sensitivity: sensitive change to compensation-linked targets.', source_type: 'insight', priority: 'high', status: 'approval_required', sensitivity: 'sensitive', approval_required: true, due_date: isoDate(new Date(now.getTime() + 12 * 86400000)) },
      { title: 'Send engagement pulse to notice-period employees', description: 'Exit-risk indicator raised for employees in notice period.', source_type: 'signal', priority: 'medium', status: 'new', sensitivity: 'routine', approval_required: false, due_date: isoDate(new Date(now.getTime() + 5 * 86400000)) },
      { title: 'Close out Q3 performance review cycle', description: 'Twelve employees still have an unsubmitted review.', source_type: 'insight', priority: 'medium', status: 'under_review', sensitivity: 'routine', approval_required: false, due_date: isoDate(new Date(now.getTime() + 9 * 86400000)) },
      { title: 'Dismissed: investigate Marketing attrition spike', description: 'Reviewed and dismissed — variance is within normal range.', source_type: 'signal', priority: 'low', status: 'dismissed', sensitivity: 'routine', approval_required: false, due_date: isoDate(new Date(now.getTime() - 8 * 86400000)), resolution_notes: 'No action required after evidence review.' },
    ].map((a) => ({
      ...a,
      assigned_to: hrUserId,
      created_by: hrUserId,
      source_ref: null,
    }));

    const { data: insertedActions, error: actionError } = await admin
      .from('hr_actions')
      .insert(actionRows)
      .select('id, title, status, approval_required, created_by');
    if (actionError) throw actionError;

    const { data: founderProfile } = await admin.from('hr_profiles').select('user_id').eq('role', 'founder').maybeSingle();
    const founderUserId = founderProfile?.user_id ?? null;

    const approvalRows = (insertedActions ?? [])
      .filter((a) => a.approval_required)
      .map((a) => ({
        action_id: a.id,
        requested_by: hrUserId,
        approver_id: founderUserId,
        decision: 'pending',
        decision_notes: null,
        requested_at: new Date(now.getTime() - 2 * 86400000).toISOString(),
      }));
    if (approvalRows.length > 0) {
      const { error: approvalError } = await admin.from('hr_approvals').insert(approvalRows);
      if (approvalError) throw approvalError;
    }

    const workflowRows: Row[] = [];
    for (const a of insertedActions ?? []) {
      workflowRows.push({ action_id: a.id, event_type: 'created', previous_state: null, new_state: 'new', triggered_by: hrUserId, metadata: { seeded: true } });
      if (a.status !== 'new') {
        workflowRows.push({ action_id: a.id, event_type: 'status_changed', previous_state: 'new', new_state: a.status as string, triggered_by: hrUserId, metadata: { seeded: true } });
      }
      if (a.approval_required) {
        workflowRows.push({ action_id: a.id, event_type: 'approval_requested', previous_state: 'new', new_state: 'approval_required', triggered_by: hrUserId, metadata: { seeded: true, approver: founderUserId } });
      }
    }
    await insertChunked('hr_workflow_events', workflowRows, 300);

    // ---------------------------------------------------------------- audit + notifications
    const auditRows: Row[] = [
      { actor_id: hrUserId, actor_email: 'hr@hrsignal.demo', entity_type: 'employee', entity_id: insertedEmployees[0]?.id ?? null, action: 'bulk_import', before_json: null, after_json: { count: insertedEmployees.length }, session_meta: { source: 'seed' } },
      { actor_id: hrUserId, actor_email: 'hr@hrsignal.demo', entity_type: 'attendance_import', entity_id: insertedImports?.[0]?.id ?? null, action: 'import_confirmed', before_json: { status: 'preview_ready' }, after_json: { status: 'confirmed' }, session_meta: { source: 'seed' } },
      { actor_id: hrUserId, actor_email: 'hr@hrsignal.demo', entity_type: 'action', entity_id: insertedActions?.[1]?.id ?? null, action: 'approval_requested', before_json: { status: 'new' }, after_json: { status: 'approval_required' }, session_meta: { source: 'seed' } },
    ];
    await insertChunked('hr_audit_log', auditRows, 100);

    const notificationRows: Row[] = [];
    if (founderUserId) {
      notificationRows.push(
        { user_id: founderUserId, title: 'Approval requested', body: 'Headcount backfill for SRE role requires your decision.', type: 'approval', entity_type: 'action', entity_id: insertedActions?.[1]?.id ?? null, link: '/executive/approvals' },
        { user_id: founderUserId, title: 'Critical risk detected', body: 'A critical workforce risk signal was raised.', type: 'critical', entity_type: 'signal', entity_id: engDeptId ?? null, link: '/executive/insights' },
      );
    }
    if (hrUserId) {
      notificationRows.push(
        { user_id: hrUserId, title: 'Attendance import confirmed', body: 'attendance_2026_07_w2.xlsx confirmed: 648 rows saved.', type: 'import', entity_type: 'attendance_import', entity_id: insertedImports?.[1]?.id ?? null, link: '/attendance' },
        { user_id: hrUserId, title: 'Action assigned to you', body: 'Run structured review for the Engineering attendance dip.', type: 'action', entity_type: 'action', entity_id: insertedActions?.[0]?.id ?? null, link: '/actions' },
      );
    }
    if (notificationRows.length > 0) await insertChunked('hr_notifications', notificationRows, 100);

    return json({
      ok: true,
      seeded: true,
      counts: {
        departments: departmentRows.length,
        employees: insertedEmployees.length + insertedInterns.length,
        attendance: attendanceRows.length,
        tasks: taskRows.length,
        reviews: reviewRows.length,
        requisitions: insertedRequisitions?.length ?? 0,
        candidates: insertedCandidates.length,
        interviews: interviewRows.length,
        internships: internshipRows.length,
        actions: insertedActions?.length ?? 0,
        approvals: approvalRows.length,
      },
    });
  } catch (error) {
    console.error('seed-demo-data failed', error);
    return json({ ok: false, reason: 'seed_failed', message: String(error) }, 500);
  }
});
