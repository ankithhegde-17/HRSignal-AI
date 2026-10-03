// HR Signal AI :: validated, idempotent recruitment stage transitions.
// Internship creates/links an intern employee; hiring updates that SAME employee record.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  applied: ['screening'],
  screening: ['interview'],
  interview: ['internship', 'full_time_offer'],
  internship: ['full_time_offer'],
  full_time_offer: ['hired'],
  hired: [],
};

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  internship: 'Internship',
  full_time_offer: 'Full-time Offer',
  hired: 'Hired',
};

const CANDIDATE_STATUSES = ['active', 'on_hold', 'rejected', 'withdrawn', 'offer_declined', 'internship_completed_not_converted'];

type Row = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

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

    const { data: profile } = await admin.from('hr_profiles').select('role, email, is_active').eq('user_id', callerId).maybeSingle();
    if (!profile?.is_active || profile.role !== 'hr') {
      return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may move candidates through the pipeline.' }, 403);
    }

    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? 'transition');
    const candidateId = String(body.candidate_id ?? '');
    if (!candidateId) return json({ ok: false, reason: 'missing_candidate_id' }, 400);

    const { data: candidate, error: candidateError } = await admin
      .from('hr_candidates')
      .select('*, hr_job_requisitions(id, job_title, department_id, hr_departments(name))')
      .eq('id', candidateId)
      .maybeSingle();
    if (candidateError) throw candidateError;
    if (!candidate) return json({ ok: false, reason: 'candidate_not_found' }, 404);

    const requisition = candidate.hr_job_requisitions as Row | null;
    const departmentId = (requisition?.department_id as string | null) ?? null;

    // ----------------------------------------------------------- schedule interview
    if (action === 'schedule_interview') {
      const { data: interview, error } = await admin.from('hr_interviews').insert({
        candidate_id: candidateId,
        interview_type: String(body.interview_type ?? 'screening'),
        interviewer_id: callerId,
        scheduled_at: body.scheduled_at ? new Date(String(body.scheduled_at)).toISOString() : null,
        status: 'scheduled',
      }).select('id').single();
      if (error) throw error;

      await admin.from('hr_audit_log').insert({
        actor_id: callerId, actor_email: profile.email, entity_type: 'candidate', entity_id: candidateId,
        action: 'interview_scheduled', after_json: { interview_id: interview.id },
        session_meta: { candidate: candidate.full_name },
      });
      return json({ ok: true, interview_id: interview.id });
    }

    // ----------------------------------------------------------- complete interview
    if (action === 'complete_interview') {
      const interviewId = String(body.interview_id ?? '');
      if (!interviewId) return json({ ok: false, reason: 'missing_interview_id' }, 400);
      const { error } = await admin.from('hr_interviews').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        rating: body.rating ?? null,
        feedback: body.feedback ?? null,
        recommendation: body.recommendation ?? null,
      }).eq('id', interviewId);
      if (error) throw error;
      await admin.from('hr_audit_log').insert({
        actor_id: callerId, actor_email: profile.email, entity_type: 'interview', entity_id: interviewId,
        action: 'interview_completed', after_json: { rating: body.rating ?? null, recommendation: body.recommendation ?? null },
        session_meta: { candidate_id: candidateId },
      });
      return json({ ok: true });
    }

    // ----------------------------------------------------------- status change
    if (action === 'update_status') {
      const nextStatus = String(body.status ?? '');
      if (!CANDIDATE_STATUSES.includes(nextStatus)) return json({ ok: false, reason: 'invalid_status' }, 400);
      const before = candidate.status as string;
      if (before === nextStatus) return json({ ok: true, already_applied: true });

      if (nextStatus === 'internship_completed_not_converted') {
        await admin.from('hr_internships')
          .update({ status: 'completed', actual_end_date: isoDate(new Date()), conversion_decision: 'not_converted' })
          .eq('candidate_id', candidateId)
          .eq('status', 'active');
      }

      const { error } = await admin.from('hr_candidates').update({ status: nextStatus }).eq('id', candidateId);
      if (error) throw error;

      await admin.from('hr_audit_log').insert({
        actor_id: callerId, actor_email: profile.email, entity_type: 'candidate', entity_id: candidateId,
        action: 'status_changed', before_json: { status: before }, after_json: { status: nextStatus },
        session_meta: { candidate: candidate.full_name, notes: body.notes ?? null },
      });
      return json({ ok: true, status: nextStatus });
    }

    // ----------------------------------------------------------- stage transition
    const toStage = String(body.to_stage ?? '');
    const fromStage = candidate.current_stage as string;
    if (!(toStage in ALLOWED_TRANSITIONS)) return json({ ok: false, reason: 'invalid_stage' }, 400);

    if (fromStage === toStage) {
      return json({ ok: true, already_applied: true, stage: toStage, linked_employee_id: candidate.linked_employee_id ?? null });
    }

    if (!ALLOWED_TRANSITIONS[fromStage]?.includes(toStage)) {
      return json({
        ok: false,
        reason: 'invalid_transition',
        message: `Cannot move from ${STAGE_LABELS[fromStage] ?? fromStage} to ${STAGE_LABELS[toStage] ?? toStage}.`,
      }, 422);
    }

    let linkedEmployeeId: string | null = (candidate.linked_employee_id as string | null) ?? null;
    let internshipId: string | null = null;

    // ---- entering internship: create OR link a single intern employee (never a duplicate)
    if (toStage === 'internship') {
      const { data: existingInternship } = await admin
        .from('hr_internships')
        .select('id, employee_id')
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingInternship?.employee_id) {
        internshipId = existingInternship.id as string;
        linkedEmployeeId = existingInternship.employee_id as string;
      } else if (linkedEmployeeId) {
        const { data: internship, error } = await admin.from('hr_internships').insert({
          candidate_id: candidateId,
          employee_id: linkedEmployeeId,
          department_id: departmentId,
          start_date: body.start_date ? String(body.start_date) : isoDate(new Date()),
          planned_end_date: body.planned_end_date ? String(body.planned_end_date) : isoDate(new Date(Date.now() + 180 * 86400000)),
          supervisor_id: callerId,
          status: 'active',
          conversion_decision: 'pending',
        }).select('id').single();
        if (error) throw error;
        internshipId = internship.id as string;
      } else {
        const { data: taken } = await admin.from('hr_employees').select('code').ilike('code', 'HRS-INT-%');
        const usedNumbers = new Set((taken ?? []).map((e) => Number(String(e.code).split('-').pop())));
        let nextNumber = 2049;
        while (usedNumbers.has(nextNumber)) nextNumber += 1;

        const { data: employee, error: employeeError } = await admin.from('hr_employees').insert({
          code: `HRS-INT-${nextNumber}`,
          full_name: candidate.full_name,
          work_email: `intern.${String(candidate.full_name).toLowerCase().replace(/[^a-z]+/g, '.')}.${nextNumber}@hrsignal.demo`,
          personal_email: candidate.email ?? null,
          phone: candidate.phone ?? null,
          department_id: departmentId,
          job_title: 'Intern',
          employment_type: 'intern',
          work_mode: 'onsite',
          joining_date: body.start_date ? String(body.start_date) : isoDate(new Date()),
          status: 'active',
          skills: [],
        }).select('id').single();
        if (employeeError) throw employeeError;
        linkedEmployeeId = employee.id as string;

        const { data: internship, error: internshipError } = await admin.from('hr_internships').insert({
          candidate_id: candidateId,
          employee_id: linkedEmployeeId,
          department_id: departmentId,
          start_date: body.start_date ? String(body.start_date) : isoDate(new Date()),
          planned_end_date: body.planned_end_date ? String(body.planned_end_date) : isoDate(new Date(Date.now() + 180 * 86400000)),
          supervisor_id: callerId,
          status: 'active',
          conversion_decision: 'pending',
        }).select('id').single();
        if (internshipError) throw internshipError;
        internshipId = internship.id as string;
      }
    }

    // ---- hiring: promote the SAME employee record to full-time
    if (toStage === 'hired') {
      if (!linkedEmployeeId) {
        const { data: existingInternship } = await admin
          .from('hr_internships').select('id, employee_id').eq('candidate_id', candidateId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        linkedEmployeeId = (existingInternship?.employee_id as string | null) ?? null;
        internshipId = (existingInternship?.id as string | null) ?? null;
      }

      if (linkedEmployeeId) {
        const { error } = await admin.from('hr_employees').update({
          employment_type: 'full-time',
          status: 'active',
          job_title: (requisition?.job_title as string | null) ?? 'Team Member',
          exit_date: null,
        }).eq('id', linkedEmployeeId);
        if (error) throw error;
      }

      if (internshipId) {
        await admin.from('hr_internships').update({
          status: 'converted',
          actual_end_date: isoDate(new Date()),
          conversion_decision: 'convert',
        }).eq('id', internshipId);
      }
    }

    const { error: updateError } = await admin.from('hr_candidates').update({
      current_stage: toStage,
      status: toStage === 'hired' ? 'active' : (candidate.status as string),
      linked_employee_id: linkedEmployeeId,
    }).eq('id', candidateId);
    if (updateError) throw updateError;

    await admin.from('hr_audit_log').insert({
      actor_id: callerId, actor_email: profile.email, entity_type: 'candidate', entity_id: candidateId,
      action: 'stage_changed',
      before_json: { current_stage: fromStage, linked_employee_id: candidate.linked_employee_id ?? null },
      after_json: { current_stage: toStage, linked_employee_id: linkedEmployeeId, internship_id: internshipId },
      session_meta: { candidate: candidate.full_name, notes: body.notes ?? null },
    });

    await admin.from('hr_notifications').insert({
      user_id: callerId,
      title: toStage === 'hired' ? 'Candidate hired' : `Candidate moved to ${STAGE_LABELS[toStage]}`,
      body: toStage === 'hired'
        ? `${candidate.full_name} was hired and the linked employee record was updated to full-time.`
        : `${candidate.full_name} moved from ${STAGE_LABELS[fromStage]} to ${STAGE_LABELS[toStage]}.`,
      type: toStage === 'hired' ? 'success' : 'info',
      entity_type: 'candidate',
      entity_id: candidateId,
      link: '/recruitment',
    });

    return json({
      ok: true,
      stage: toStage,
      previous_stage: fromStage,
      linked_employee_id: linkedEmployeeId,
      internship_id: internshipId,
    });
  } catch (error) {
    console.error('candidate-transition failed', error);
    return json({ ok: false, reason: 'transition_failed', message: String(error) }, 500);
  }
});
