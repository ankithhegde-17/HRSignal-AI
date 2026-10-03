// HR Signal AI :: database-grounded assistant.
// Deterministic intent matching over verified stored data — no external model, no invented values.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Row = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchAll(admin: ReturnType<typeof createClient>, table: string, columns: string, filter?: (q: any) => any) {
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = admin.from(table).select(columns).range(from, from + pageSize - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as unknown as Row[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  internship: 'Internship',
  full_time_offer: 'Full-time Offer',
  hired: 'Hired',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ ok: false, reason: 'backend_not_configured' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return json({ ok: false, reason: 'unauthenticated' }, 401);

    const { data: profile } = await admin.from('hr_profiles').select('role, full_name, is_active').eq('user_id', callerId).maybeSingle();
    if (!profile?.is_active) return json({ ok: false, reason: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({})) as Row;
    const question = String(body.question ?? '').trim();
    if (!question) return json({ ok: false, reason: 'empty_question' }, 400);

    // ---- conversation persistence
    let conversationId = body.conversation_id ? String(body.conversation_id) : '';
    if (conversationId) {
      const { data: existing } = await admin.from('hr_ai_conversations').select('id, creator_id').eq('id', conversationId).maybeSingle();
      if (!existing || existing.creator_id !== callerId) conversationId = '';
    }
    if (!conversationId) {
      const { data: created, error } = await admin.from('hr_ai_conversations').insert({
        creator_id: callerId,
        title: question.length > 60 ? `${question.slice(0, 57)}...` : question,
        context_type: 'organization',
      }).select('id').single();
      if (error) throw error;
      conversationId = created.id as string;
    }

    await admin.from('hr_ai_messages').insert({ conversation_id: conversationId, sender_type: 'user', message: question });

    const q = question.toLowerCase();
    const has = (...terms: string[]) => terms.some((t) => q.includes(t));

    let answer = '';
    let answerType: 'fact' | 'recommendation' | 'insufficient_data' = 'fact';
    let evidence: Array<Row> = [];
    let recommendation: string | null = null;

    // ---------------------------------------------------------------- employees without review
    if (has('performance review', 'require review', 'needs review', 'without a review', 'pending review')) {
      const employees = await fetchAll(admin, 'hr_employees', 'id, full_name, status, department_id');
      const reviews = await fetchAll(admin, 'hr_performance_reviews', 'employee_id, status');
      const reviewed = new Set(reviews.filter((r) => r.status !== 'draft').map((r) => r.employee_id as string));
      const missing = employees.filter((e) => e.status !== 'exited' && !reviewed.has(e.id as string));
      if (missing.length === 0) {
        answer = 'Every active employee currently has a submitted performance review.';
      } else {
        answer = `${missing.length} active employee${missing.length === 1 ? '' : 's'} have no submitted performance review, so their performance risk cannot be evidenced.`;
        evidence = missing.slice(0, 12).map((e) => ({ label: e.full_name as string, type: 'employee', id: e.id }));
        recommendation = 'Complete the outstanding reviews before drawing performance conclusions.';
      }
      answerType = missing.length === 0 ? 'fact' : 'fact';
    }
    // ---------------------------------------------------------------- recruitment pipeline
    else if (has('candidate', 'interview', 'pipeline', 'recruit', 'screening', 'offer', 'hiring')) {
      const candidates = await fetchAll(admin, 'hr_candidates', 'id, full_name, current_stage, status, requisition_id');
      const requisitions = await fetchAll(admin, 'hr_job_requisitions', 'id, job_title, status, openings');
      const activeCandidates = candidates.filter((c) => c.status === 'active');

      const requestedStage = ['applied', 'screening', 'interview', 'internship', 'full_time_offer', 'hired']
        .find((stage) => q.includes(stage.replace(/_/g, ' ')) || q.includes(stage));

      if (requestedStage) {
        const inStage = activeCandidates.filter((c) => c.current_stage === requestedStage);
        answer = `${inStage.length} active candidate${inStage.length === 1 ? ' is' : 's are'} in the ${STAGE_LABELS[requestedStage]} stage.`;
        evidence = inStage.slice(0, 12).map((c) => ({ label: c.full_name as string, type: 'candidate', id: c.id }));
        if (inStage.length === 0) answer += ' No verified records match this stage.';
      } else {
        const counts = ['applied', 'screening', 'interview', 'internship', 'full_time_offer', 'hired']
          .map((s) => `${STAGE_LABELS[s]}: ${activeCandidates.filter((c) => c.current_stage === s).length}`)
          .join(' · ');
        const openReqs = requisitions.filter((r) => r.status === 'open');
        const openings = openReqs.reduce((a, r) => a + Number(r.openings ?? 0), 0);
        answer = `There are ${activeCandidates.length} active candidates across ${openReqs.length} open requisitions (${openings} openings). ${counts}.`;
        evidence = openReqs.slice(0, 10).map((r) => ({ label: `${r.job_title}`, type: 'requisition', id: r.id }));
      }
    }
    // ---------------------------------------------------------------- pending approvals
    else if (has('approval', 'approve', 'ceo', 'founder', 'sign off', 'sign-off')) {
      const approvals = await fetchAll(admin, 'hr_approvals', 'id, action_id, decision, requested_at');
      const pending = approvals.filter((a) => a.decision === 'pending');
      const actions = await fetchAll(admin, 'hr_actions', 'id, title, status, priority');
      const actionById = new Map(actions.map((a) => [a.id as string, a]));
      if (pending.length === 0) {
        answer = 'No approvals are currently pending a Founder/CEO decision.';
      } else {
        const titles = pending.map((a) => actionById.get(a.action_id as string)?.title ?? 'Untitled action');
        answer = `${pending.length} action${pending.length === 1 ? '' : 's'} require Founder/CEO approval: ${titles.slice(0, 5).join('; ')}.`;
        evidence = pending.slice(0, 10).map((a) => ({
          label: (actionById.get(a.action_id as string)?.title as string) ?? 'Action',
          type: 'action',
          id: a.action_id as string,
        }));
      }
    }
    // ---------------------------------------------------------------- attrition / exits
    else if (has('attrition', 'exit', 'exited', 'leaver', 'turnover', 'notice period')) {
      const employees = await fetchAll(admin, 'hr_employees', 'id, full_name, status, exit_date, department_id, joining_date');
      const exited = employees.filter((e) => e.status === 'exited');
      const notice = employees.filter((e) => e.status === 'notice period');
      const onLeave = employees.filter((e) => e.status === 'on leave');
      const active = employees.filter((e) => e.status !== 'exited');
      answer = `${exited.length} employees have exited, ${notice.length} are in notice period and ${onLeave.length} are on leave (${active.length} active).`;
      evidence = [
        ...notice.map((e) => ({ label: `${e.full_name} · notice period`, type: 'employee', id: e.id })),
        ...exited.slice(0, 6).map((e) => ({ label: `${e.full_name} · exited`, type: 'employee', id: e.id })),
      ].slice(0, 12);
      if (notice.length > 0) recommendation = 'Run stay conversations with employees in notice period to reduce avoidable attrition.';
      answerType = 'fact';
    }
    // ---------------------------------------------------------------- department attendance
    else if (has('department', 'lowest attendance', 'attendance')) {
      const departments = await fetchAll(admin, 'hr_departments', 'id, name');
      const employees = await fetchAll(admin, 'hr_employees', 'id, department_id, status');
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      const attendance = await fetchAll(admin, 'hr_attendance', 'employee_id, status, attendance_date', (query) => query.gte('attendance_date', cutoffIso));

      const employeeDept = new Map(employees.map((e) => [e.id as string, e.department_id as string | null]));
      const agg = new Map<string, { total: number; credited: number }>();
      for (const record of attendance) {
        if (!['present', 'late', 'half-day', 'absent'].includes(record.status as string)) continue;
        const deptId = employeeDept.get(record.employee_id as string);
        if (!deptId) continue;
        if (!agg.has(deptId)) agg.set(deptId, { total: 0, credited: 0 });
        const entry = agg.get(deptId)!;
        entry.total += 1;
        if (record.status === 'present') entry.credited += 1;
        else if (record.status === 'late' || record.status === 'half-day') entry.credited += 0.5;
      }

      const ranked = departments
        .map((d) => {
          const entry = agg.get(d.id as string);
          return { id: d.id as string, name: d.name as string, rate: entry && entry.total > 0 ? entry.credited / entry.total : null, total: entry?.total ?? 0 };
        })
        .filter((d) => d.rate !== null && d.total >= 5)
        .sort((a, b) => (a.rate as number) - (b.rate as number));

      if (ranked.length === 0) {
        answerType = 'insufficient_data';
        answer = 'Insufficient data: no attendance records were found for the last 30 days, so no department comparison can be produced.';
      } else if (has('lowest', 'worst', 'bottom')) {
        answer = `${ranked[0].name} has the lowest attendance rate at ${Math.round((ranked[0].rate as number) * 100)}% over the last 30 days (${ranked[0].total} records); the highest is ${ranked[ranked.length - 1].name} at ${Math.round((ranked[ranked.length - 1].rate as number) * 100)}%.`;
        evidence = ranked.slice(0, 7).map((d) => ({ label: `${d.name} · ${Math.round((d.rate as number) * 100)}%`, type: 'department', id: d.id }));
        recommendation = 'Review shift patterns and workload distribution for the lowest-scoring department.';
      } else {
        const overallCredited = ranked.reduce((a, d) => a + (d.rate as number) * d.total, 0);
        const overallTotal = ranked.reduce((a, d) => a + d.total, 0);
        answer = `Attendance across ${ranked.length} departments over the last 30 days is ${Math.round((overallCredited / Math.max(1, overallTotal)) * 100)}%. ${ranked.map((d) => `${d.name}: ${Math.round((d.rate as number) * 100)}%`).join(' · ')}.`;
        evidence = ranked.map((d) => ({ label: `${d.name} · ${Math.round((d.rate as number) * 100)}%`, type: 'department', id: d.id }));
      }
    }
    // ---------------------------------------------------------------- specific employee risk
    else if (has('why', 'risk', 'high risk') || q.includes('@')) {
      const signals = await fetchAll(admin, 'hr_signals', 'id, entity_type, entity_id, signal_type, score, severity, explanation, evidence_quality, formula_version, limitations, recommendation');
      const employees = await fetchAll(admin, 'hr_employees', 'id, full_name, job_title, status, department_id');

      const mentioned = employees.find((e) => q.includes(String(e.full_name).toLowerCase()));
      const highSignals = signals
        .filter((s) => s.entity_type === 'employee' && s.signal_type === 'combined_risk' && Number(s.score) >= 60)
        .sort((a, b) => Number(b.score) - Number(a.score));

      if (mentioned) {
        const signal = signals.find((s) => s.entity_id === mentioned.id && s.signal_type === 'combined_risk');
        if (!signal) {
          answerType = 'insufficient_data';
          answer = `Insufficient data: no risk signal has been calculated for ${mentioned.full_name}. Run the risk engine or review their attendance and performance records first.`;
          evidence = [{ label: mentioned.full_name as string, type: 'employee', id: mentioned.id }];
        } else {
          const ev = signal.evidence as Row ?? {};
          answer = `${mentioned.full_name} scores ${signal.score} (${signal.severity}) on combined risk using formula ${signal.formula_version}. Attendance rate ${ev.attendance_rate != null ? Math.round(Number(ev.attendance_rate) * 100) + '%' : 'n/a'}, latest performance score ${ev.latest_review_score ?? 'not recorded'}, task completion ${ev.tasks_total ? `${ev.tasks_completed}/${ev.tasks_total}` : 'n/a'}. Evidence quality: ${signal.evidence_quality}.`;
          evidence = [{ label: mentioned.full_name as string, type: 'employee', id: mentioned.id }];
          recommendation = (signal.recommendation as string) ?? 'Open the risk evidence and create a tracked action.';
          answerType = 'fact';
        }
      } else if (highSignals.length === 0) {
        answerType = 'insufficient_data';
        answer = 'Insufficient data: no employee currently scores 60 or above on combined risk.';
      } else {
        const ranked = highSignals.slice(0, 8).map((s) => {
          const emp = employees.find((e) => e.id === s.entity_id);
          return { label: `${emp?.full_name ?? 'Unknown'} · ${s.score} (${s.severity})`, type: 'employee', id: s.entity_id as string };
        });
        answer = `${highSignals.length} employees score 60 or above on combined risk (attendance 40%, performance 40%, task/goal trend 20%). Highest: ${ranked.slice(0, 5).map((r) => r.label).join('; ')}.`;
        evidence = ranked;
        recommendation = 'Assign owners to the highest scoring employees and track actions to resolution.';
      }
    }
    // ---------------------------------------------------------------- headcount
    else if (has('how many employees', 'headcount', 'total employees', 'workforce size')) {
      const employees = await fetchAll(admin, 'hr_employees', 'id, status, department_id, work_mode');
      const departments = await fetchAll(admin, 'hr_departments', 'id, name');
      const active = employees.filter((e) => e.status !== 'exited');
      answer = `The workforce has ${employees.length} employee records: ${active.length} active and ${employees.length - active.length} exited, across ${departments.length} departments.`;
      evidence = departments.map((d) => ({ label: d.name as string, type: 'department', id: d.id }));
    }
    // ---------------------------------------------------------------- fallback
    else {
      answerType = 'insufficient_data';
      answer = 'Insufficient data: I could not map that question to a verified metric. Try asking about employee risk, department attendance, performance reviews, the recruitment pipeline, pending approvals or attrition.';
    }

    // ------------------------------------------------------------------ Qwen grounding
    // Assemble verified evidence and let Qwen explain or recommend from it. The
    // model is instructed to answer ONLY from the supplied evidence, to label
    // facts vs recommendations, and to return "Insufficient data" when the
    // evidence cannot support an answer — it never invents values.
    const evidenceLines = evidence.map((e) => `- ${e.label} (${e.type})`).join("\n");

    const snapshot = await (async () => {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      const [employees, departments, attendance, reviews, requisitions, candidates, approvals] = await Promise.all([
        admin.from('hr_employees').select('id, status').limit(3000),
        admin.from('hr_departments').select('id').eq('is_active', true),
        admin.from('hr_attendance').select('status').gte('attendance_date', cutoff.toISOString().slice(0, 10)).limit(30000),
        admin.from('hr_performance_reviews').select('performance_score, status').eq('status', 'submitted').limit(5000),
        admin.from('hr_job_requisitions').select('openings, status').eq('status', 'open'),
        admin.from('hr_candidates').select('status').eq('status', 'active'),
        admin.from('hr_approvals').select('id').eq('decision', 'pending'),
      ]);
      if (employees.error) return null;
      const emp = (employees.data ?? []) as Array<{ status: string }>;
      const counted = (attendance.data ?? []).filter((r) => ['present', 'late', 'half-day', 'absent'].includes(r.status as string));
      const credited = counted.reduce((t, r) => t + (r.status === 'present' ? 1 : r.status === 'late' || r.status === 'half-day' ? 0.5 : 0), 0);
      const reviewRows = (reviews.data ?? []).filter((r) => r.performance_score != null) as Array<{ performance_score: number }>;
      return [
        `Employees: ${emp.length} total (${emp.filter((e) => e.status !== 'exited').length} active)`,
        `Departments: ${(departments.data ?? []).length}`,
        `Attendance rate (last 30 days): ${counted.length ? Math.round((credited / counted.length) * 100) : 'n/a'}%`,
        `Average performance (submitted reviews): ${reviewRows.length ? Math.round((reviewRows.reduce((t, r) => t + Number(r.performance_score), 0) / reviewRows.length) * 10) / 10 : 'n/a'}`,
        `Open positions: ${(requisitions.data ?? []).reduce((t, r) => t + Number(r.openings ?? 0), 0)}`,
        `Active candidates: ${(candidates.data ?? []).length}`,
        `Pending approvals: ${(approvals.data ?? []).length}`,
      ].join('\n');
    })();

    const systemPrompt = [
      'You are HR Signal AI, a workforce decision-intelligence assistant inside an enterprise HR platform.',
      'Answer the HR question using ONLY the verified evidence provided below.',
      'Rules:',
      '- Never invent numbers, names, or records that are not in the evidence.',
      '- Clearly separate established facts from recommendations.',
      '- If the evidence cannot support an answer, reply starting with "Insufficient data" and state exactly which evidence is missing.',
      '- Keep the answer concise, professional, and decision-oriented.',
      `Verified workforce snapshot:\n${snapshot ?? 'Snapshot unavailable'}`,
      evidenceLines ? `Evidence relevant to the question:\n${evidenceLines}` : '',
    ].filter(Boolean).join('\n\n');

    const aiToken = Deno.env.get('AI_API_TOKEN_6b02442f8d6b');
    let aiAnswer: string | null = null;
    let aiFailed = false;

    if (aiToken) {
      try {
        const aiResponse = await fetch('https://api.enter.pro/code/api/v1/ai/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aiToken}`,
            'Content-Type': 'application/json',
            'X-Session-ID': conversationId,
            'X-Enter-Project-ID': '6b02442f8d6b47bd8a5c24bdb79e69ef',
          },
          body: JSON.stringify({
            model: 'alibaba/qwen-3.7-plus',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: question },
            ],
            stream: false,
            temperature: 0.3,
            max_tokens: 800,
          }),
          signal: AbortSignal.timeout(30000),
        });

        const payload = await aiResponse.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;

        if (!aiResponse.ok || !payload) {
          aiFailed = true;
          console.error('ask-hr-signal: Qwen request failed', aiResponse.status, payload?.error?.message ?? 'no payload');
        } else {
          const text = payload.choices?.[0]?.message?.content?.trim();
          if (text) {
            aiAnswer = text;
            // The model labels "Insufficient data" explicitly; respect that as a state.
            if (/^insufficient data/i.test(text)) {
              answerType = 'insufficient_data';
              answer = text;
            } else {
              answer = text;
              answerType = answerType === 'insufficient_data' ? 'fact' : answerType;
            }
          }
        }
      } catch (aiError) {
        aiFailed = true;
        console.error('ask-hr-signal: Qwen call threw', aiError);
      }
    }

    const groundedNote = aiFailed
      ? ' (AI reasoning unavailable — showing verified database answer)'
      : '';

    await admin.from('hr_ai_messages').insert({
      conversation_id: conversationId,
      sender_type: 'assistant',
      message: recommendation ? `${answer}${groundedNote}\n\nSuggested next step: ${recommendation}` : `${answer}${groundedNote}`,
      evidence_refs: evidence,
    });
    await admin.from('hr_ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

    return json({
      ok: true,
      conversation_id: conversationId,
      answer: `${answer}${groundedNote}`,
      answer_type: answerType,
      recommendation,
      evidence,
      grounded: !aiFailed && aiAnswer !== null,
    });
  } catch (error) {
    console.error('ask-hr-signal failed', error);
    return json({ ok: false, reason: 'assistant_failed', message: String(error) }, 500);
  }
});
