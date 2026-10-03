// HR Signal AI :: action lifecycle + founder approval workflow.
// Every state change is validated server-side and recorded as a workflow event and audit entry.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_STATES: Record<string, string[]> = {
  new: ['under_review', 'approval_required', 'in_progress', 'dismissed'],
  under_review: ['approval_required', 'in_progress', 'resolved', 'dismissed'],
  approval_required: ['approved', 'rejected'],
  approved: ['in_progress', 'resolved'],
  rejected: ['under_review', 'dismissed'],
  in_progress: ['resolved', 'failed'],
  resolved: [],
  failed: [],
  dismissed: [],
};

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const SOURCE_TYPES = ['manual', 'signal', 'insight', 'recommendation', 'candidate_conversion', 'attendance_import'];

type Row = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    const { data: profile } = await admin.from('hr_profiles').select('role, email, full_name, is_active').eq('user_id', callerId).maybeSingle();
    if (!profile?.is_active) return json({ ok: false, reason: 'forbidden' }, 403);
    const callerRole = profile.role as 'hr' | 'founder';

    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? '');

    async function logWorkflow(actionId: string, eventType: string, previousState: string | null, newState: string | null, metadata: Row = {}) {
      await admin.from('hr_workflow_events').insert({
        action_id: actionId,
        event_type: eventType,
        previous_state: previousState,
        new_state: newState,
        triggered_by: callerId,
        metadata,
      });
    }

    async function logAudit(entityType: string, entityId: string, auditAction: string, before: Row | null, after: Row | null, meta: Row = {}) {
      await admin.from('hr_audit_log').insert({
        actor_id: callerId,
        actor_email: profile.email,
        entity_type: entityType,
        entity_id: entityId,
        action: auditAction,
        before_json: before,
        after_json: after,
        session_meta: meta,
      });
    }

    // ------------------------------------------------------------------ create
    if (action === 'create') {
      // Actions are created and owned by HR. The Founder/CEO approves decisions
      // and may comment, but does not open HR work items.
      if (callerRole !== 'hr') {
        return json(
          { ok: false, reason: 'forbidden', message: 'Only the HR role may create and assign actions.' },
          403,
        );
      }
      const title = String(body.title ?? '').trim();
      if (!title) return json({ ok: false, reason: 'missing_title' }, 400);

      const priority = PRIORITIES.includes(String(body.priority)) ? String(body.priority) : 'medium';
      const sourceType = SOURCE_TYPES.includes(String(body.source_type)) ? String(body.source_type) : 'manual';
      const sensitivity = body.sensitivity === 'sensitive' ? 'sensitive' : 'routine';
      const approvalRequired = body.approval_required === true || sensitivity === 'sensitive';

      const { data: created, error } = await admin.from('hr_actions').insert({
        title,
        description: body.description ? String(body.description) : null,
        source_type: sourceType,
        source_ref: body.source_ref ? String(body.source_ref) : null,
        priority,
        assigned_to: body.assigned_to ? String(body.assigned_to) : null,
        created_by: callerId,
        due_date: body.due_date ? String(body.due_date) : null,
        status: 'new',
        sensitivity,
        approval_required: approvalRequired,
      }).select('*').single();
      if (error) throw error;

      await logWorkflow(created.id, 'created', null, 'new', { title, sensitivity, approval_required: approvalRequired });
      await logAudit('action', created.id, 'created', null, { title, status: 'new', priority }, { source_type: sourceType });

      if (created.assigned_to) {
        await admin.from('hr_notifications').insert({
          user_id: created.assigned_to,
          title: 'Action assigned to you',
          body: title,
          type: 'action',
          entity_type: 'action',
          entity_id: created.id,
          link: '/actions',
        });
      }

      return json({ ok: true, action: created });
    }

    const actionId = String(body.action_id ?? '');
    let current: Row | null = null;
    if (actionId) {
      const { data, error } = await admin.from('hr_actions').select('*').eq('id', actionId).maybeSingle();
      if (error) throw error;
      if (!data) return json({ ok: false, reason: 'action_not_found' }, 404);
      current = data as Row;
    }

    // ------------------------------------------------------------------ assign
    if (action === 'assign') {
      if (callerRole !== 'hr') return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may reassign actions.' }, 403);
      if (!current) return json({ ok: false, reason: 'missing_action_id' }, 400);
      const assignee = String(body.assigned_to ?? '');
      if (!assignee) return json({ ok: false, reason: 'missing_assignee' }, 400);

      const { error } = await admin.from('hr_actions').update({ assigned_to: assignee }).eq('id', actionId);
      if (error) throw error;

      await logWorkflow(actionId, 'assigned', current.status as string, current.status as string, { assigned_to: assignee });
      await logAudit('action', actionId, 'assigned', { assigned_to: current.assigned_to ?? null }, { assigned_to: assignee });
      await admin.from('hr_notifications').insert({
        user_id: assignee, title: 'Action assigned to you', body: current.title as string, type: 'action',
        entity_type: 'action', entity_id: actionId, link: '/actions',
      });
      return json({ ok: true });
    }

    // ------------------------------------------------------------------ request approval
    if (action === 'request_approval') {
      if (callerRole !== 'hr') return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may request approval.' }, 403);
      if (!current) return json({ ok: false, reason: 'missing_action_id' }, 400);

      const { data: existingPending } = await admin.from('hr_approvals')
        .select('id').eq('action_id', actionId).eq('decision', 'pending').maybeSingle();
      if (existingPending) return json({ ok: true, already_requested: true, approval_id: existingPending.id });

      const { data: founder } = await admin.from('hr_profiles').select('user_id').eq('role', 'founder').eq('is_active', true).limit(1).maybeSingle();

      const { data: approval, error } = await admin.from('hr_approvals').insert({
        action_id: actionId,
        requested_by: callerId,
        approver_id: founder?.user_id ?? null,
        decision: 'pending',
        requested_at: new Date().toISOString(),
      }).select('id').single();
      if (error) throw error;

      const { error: updateError } = await admin.from('hr_actions').update({
        status: 'approval_required',
        approval_required: true,
        sensitivity: 'sensitive',
      }).eq('id', actionId);
      if (updateError) throw updateError;

      await logWorkflow(actionId, 'approval_requested', current.status as string, 'approval_required', { approval_id: approval.id, approver: founder?.user_id ?? null });
      await logAudit('approval', approval.id, 'requested', null, { action_id: actionId, decision: 'pending' });

      if (founder?.user_id) {
        await admin.from('hr_notifications').insert({
          user_id: founder.user_id,
          title: 'Approval requested',
          body: current.title as string,
          type: 'approval',
          entity_type: 'action',
          entity_id: actionId,
          link: '/executive/approvals',
        });
      }

      return json({ ok: true, approval_id: approval.id });
    }

    // ------------------------------------------------------------------ founder decision
    if (action === 'decide') {
      if (callerRole !== 'founder') return json({ ok: false, reason: 'forbidden', message: 'Only the Founder/CEO may decide approvals.' }, 403);
      const approvalId = String(body.approval_id ?? '');
      if (!approvalId) return json({ ok: false, reason: 'missing_approval_id' }, 400);
      const decision = String(body.decision ?? '');
      if (!['approved', 'rejected'].includes(decision)) return json({ ok: false, reason: 'invalid_decision' }, 400);

      const { data: approval, error: approvalError } = await admin.from('hr_approvals').select('*').eq('id', approvalId).maybeSingle();
      if (approvalError) throw approvalError;
      if (!approval) return json({ ok: false, reason: 'approval_not_found' }, 404);
      if (approval.decision !== 'pending') {
        return json({ ok: true, already_decided: true, decision: approval.decision });
      }

      const { error: decideError } = await admin.from('hr_approvals').update({
        decision,
        decision_notes: body.decision_notes ? String(body.decision_notes) : null,
        approver_id: callerId,
        decided_at: new Date().toISOString(),
      }).eq('id', approvalId);
      if (decideError) throw decideError;

      const { data: linkedAction } = await admin.from('hr_actions').select('*').eq('id', approval.action_id).maybeSingle();

      const { error: actionError } = await admin.from('hr_actions').update({
        status: decision,
        resolution_notes: decision === 'rejected' && body.decision_notes ? String(body.decision_notes) : (linkedAction?.resolution_notes ?? null),
      }).eq('id', approval.action_id);
      if (actionError) throw actionError;

      await logWorkflow(approval.action_id, decision === 'approved' ? 'approved' : 'rejected', linkedAction?.status as string ?? null, decision, {
        approval_id: approvalId,
        decision_notes: body.decision_notes ?? null,
      });
      await logAudit('approval', approvalId, decision, { decision: 'pending' }, { decision, notes: body.decision_notes ?? null });

      if (approval.requested_by) {
        await admin.from('hr_notifications').insert({
          user_id: approval.requested_by,
          title: decision === 'approved' ? 'Action approved' : 'Action rejected',
          body: `${linkedAction?.title ?? 'Action'}: ${decision === 'approved' ? 'approved by the Founder/CEO.' : 'rejected by the Founder/CEO.'}`,
          type: decision === 'approved' ? 'success' : 'warning',
          entity_type: 'action',
          entity_id: approval.action_id,
          link: '/actions',
        });
      }

      return json({ ok: true, decision, action_id: approval.action_id });
    }

    // ------------------------------------------------------------------ state transitions
    if (['start', 'resolve', 'fail', 'dismiss', 'reopen'].includes(action)) {
      if (callerRole !== 'hr') return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may progress actions.' }, 403);
      if (!current) return json({ ok: false, reason: 'missing_action_id' }, 400);

      const targetByAction: Record<string, string> = {
        start: 'in_progress',
        resolve: 'resolved',
        fail: 'failed',
        dismiss: 'dismissed',
        reopen: 'under_review',
      };
      const target = targetByAction[action];
      const from = current.status as string;

      if (from === target) return json({ ok: true, already_applied: true, status: target });
      if (!ALLOWED_STATES[from]?.includes(target)) {
        return json({ ok: false, reason: 'invalid_transition', message: `Cannot move an action from "${from}" to "${target}".` }, 422);
      }
      if ((current.approval_required as boolean) && ['in_progress', 'resolved'].includes(target) && !['approved', 'in_progress'].includes(from)) {
        return json({ ok: false, reason: 'approval_required', message: 'This action is sensitive and must be approved before work starts.' }, 422);
      }

      const patch: Row = { status: target };
      if (['resolve', 'fail', 'dismiss'].includes(action)) {
        patch.resolution_notes = body.resolution_notes ? String(body.resolution_notes) : (current.resolution_notes ?? null);
      }

      const { error } = await admin.from('hr_actions').update(patch).eq('id', actionId);
      if (error) throw error;

      await logWorkflow(actionId, 'status_changed', from, target, { notes: body.resolution_notes ?? null });
      await logAudit('action', actionId, `status_${target}`, { status: from }, { status: target, notes: body.resolution_notes ?? null });

      return json({ ok: true, status: target });
    }

    // ------------------------------------------------------------------ comment
    if (action === 'comment') {
      if (!current) return json({ ok: false, reason: 'missing_action_id' }, 400);
      const comment = String(body.comment ?? '').trim();
      if (!comment) return json({ ok: false, reason: 'empty_comment' }, 400);
      await logWorkflow(actionId, 'commented', current.status as string, current.status as string, {
        comment,
        author: profile.full_name,
        role: callerRole,
      });
      return json({ ok: true });
    }

    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (error) {
    console.error('action-workflow failed', error);
    return json({ ok: false, reason: 'workflow_failed', message: String(error) }, 500);
  }
});
