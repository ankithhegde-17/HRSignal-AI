// HR Signal AI :: team lifecycle and membership management.
// HR-only. Every mutation validates ownership rules, is idempotent, and records
// audit entries. Archived teams never delete members or historical records.
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

    const { data: profile } = await admin
      .from('hr_profiles')
      .select('role, email, full_name, is_active')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile?.is_active || profile.role !== 'hr') {
      return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may manage teams.' }, 403);
    }

    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? '');

    async function audit(entityType: string, entityId: string, auditAction: string, before: Row | null, after: Row | null, meta: Row = {}) {
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

    // ---------------------------------------------------------------- create
    if (action === 'create') {
      const name = String(body.name ?? '').trim();
      const teamCode = String(body.team_code ?? '').trim();
      const departmentId = String(body.department_id ?? '');
      if (!name || !teamCode || !departmentId) {
        return json({ ok: false, reason: 'missing_fields', message: 'Name, team code and department are required.' }, 400);
      }

      const { data: department } = await admin.from('hr_departments').select('id').eq('id', departmentId).maybeSingle();
      if (!department) return json({ ok: false, reason: 'department_not_found' }, 404);

      const { data: team, error } = await admin.from('hr_teams').insert({
        department_id: departmentId,
        name,
        team_code: teamCode.toUpperCase(),
        description: body.description ? String(body.description) : null,
        capacity: body.capacity != null && body.capacity !== '' ? Number(body.capacity) : null,
        status: 'active',
      }).select('id, name, team_code').single();
      if (error) throw error;

      await audit('team', team.id, 'team_created', null, { name, team_code: team.team_code, department_id: departmentId });
      return json({ ok: true, team });
    }

    // ---------------------------------------------------------------- update
    if (action === 'update') {
      const teamId = String(body.team_id ?? '');
      if (!teamId) return json({ ok: false, reason: 'missing_team_id' }, 400);
      const { data: current } = await admin.from('hr_teams').select('*').eq('id', teamId).maybeSingle();
      if (!current) return json({ ok: false, reason: 'team_not_found' }, 404);
      if (current.status === 'archived') {
        return json({ ok: false, reason: 'team_archived', message: 'Archived teams cannot be edited. Unarchive first.' }, 409);
      }

      const patch: Row = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.team_code !== undefined) patch.team_code = String(body.team_code).trim().toUpperCase();
      if (body.description !== undefined) patch.description = String(body.description) || null;
      if (body.capacity !== undefined) patch.capacity = body.capacity === '' || body.capacity == null ? null : Number(body.capacity);

      const { data: updated, error } = await admin.from('hr_teams').update(patch).eq('id', teamId).select('*').single();
      if (error) throw error;

      await audit('team', teamId, 'team_updated', current as Row, updated as Row);
      return json({ ok: true, team: updated });
    }

    // ---------------------------------------------------------------- archive / unarchive
    if (action === 'archive' || action === 'unarchive') {
      const teamId = String(body.team_id ?? '');
      if (!teamId) return json({ ok: false, reason: 'missing_team_id' }, 400);
      const { data: current } = await admin.from('hr_teams').select('*').eq('id', teamId).maybeSingle();
      if (!current) return json({ ok: false, reason: 'team_not_found' }, 404);

      const archived = action === 'archive';
      const { error } = await admin.from('hr_teams').update({
        status: archived ? 'archived' : 'active',
        archived_at: archived ? new Date().toISOString() : null,
        archived_by: archived ? callerId : null,
      }).eq('id', teamId);
      if (error) throw error;

      await audit('team', teamId, action === 'archive' ? 'team_archived' : 'team_unarchived',
        current as Row,
        { status: archived ? 'archived' : 'active' },
        { reason: body.reason ? String(body.reason) : null });

      return json({ ok: true, status: archived ? 'archived' : 'active' });
    }

    // ---------------------------------------------------------------- assign / remove members
    if (action === 'assign_members') {
      const teamId = String(body.team_id ?? '');
      const add = Array.isArray(body.add) ? (body.add as string[]).filter(Boolean) : [];
      const remove = Array.isArray(body.remove) ? (body.remove as string[]).filter(Boolean) : [];
      if (!teamId) return json({ ok: false, reason: 'missing_team_id' }, 400);
      if (add.length === 0 && remove.length === 0) {
        return json({ ok: true, added: 0, removed: 0, message: 'No membership changes requested.' });
      }

      const { data: team } = await admin.from('hr_teams').select('id, department_id, name, status').eq('id', teamId).maybeSingle();
      if (!team) return json({ ok: false, reason: 'team_not_found' }, 404);
      if (team.status === 'archived') {
        return json({ ok: false, reason: 'team_archived', message: 'Archived teams cannot accept membership changes.' }, 409);
      }

      // Validate every employee being added: must exist and belong to the same department.
      let added = 0;
      let removed = 0;
      const validationFailures: string[] = [];

      if (add.length > 0) {
        const { data: members } = await admin
          .from('hr_employees')
          .select('id, full_name, department_id, team_id')
          .in('id', add);
        for (const id of add) {
          const member = (members ?? []).find((m) => m.id === id);
          if (!member) { validationFailures.push(`Employee ${id} does not exist`); continue; }
          if (member.department_id !== team.department_id) {
            validationFailures.push(`${member.full_name} belongs to another department`);
            continue;
          }
        }
        if (validationFailures.length > 0) {
          return json({ ok: false, reason: 'invalid_members', failures: validationFailures }, 422);
        }
        const toAssign = (members ?? []).filter((m) => m.team_id !== teamId).map((m) => m.id);
        if (toAssign.length > 0) {
          const { error } = await admin.from('hr_employees').update({ team_id: teamId }).in('id', toAssign);
          if (error) throw error;
          added = toAssign.length;
        }
      }

      if (remove.length > 0) {
        const { data: members } = await admin
          .from('hr_employees')
          .select('id, team_id')
          .in('id', remove);
        const toRemove = (members ?? []).filter((m) => m.team_id === teamId).map((m) => m.id);
        if (toRemove.length > 0) {
          // Members are unassigned, never deleted. Leads are also cleared so the
          // team never has a lead who is not a member.
          const { error } = await admin.from('hr_employees').update({ team_id: null }).in('id', toRemove);
          if (error) throw error;
          const { error: leadError } = await admin
            .from('hr_teams')
            .update({ team_lead_id: null })
            .eq('id', teamId)
            .in('team_lead_id', toRemove);
          if (leadError) throw leadError;
          removed = toRemove.length;
        }
      }

      await audit('team', teamId, 'team_members_updated',
        null,
        { added, removed, add, remove },
        { team_name: team.name });

      return json({ ok: true, added, removed, failures: validationFailures });
    }

    // ---------------------------------------------------------------- set team lead
    if (action === 'set_lead') {
      const teamId = String(body.team_id ?? '');
      if (!teamId) return json({ ok: false, reason: 'missing_team_id' }, 400);
      const leadId = body.team_lead_id ? String(body.team_lead_id) : null;

      const { data: team } = await admin.from('hr_teams').select('id, department_id, name, team_lead_id, status').eq('id', teamId).maybeSingle();
      if (!team) return json({ ok: false, reason: 'team_not_found' }, 404);
      if (team.status === 'archived') {
        return json({ ok: false, reason: 'team_archived', message: 'Archived teams cannot be assigned a lead.' }, 409);
      }

      if (leadId) {
        const { data: lead } = await admin.from('hr_employees').select('id, full_name, department_id, team_id, status').eq('id', leadId).maybeSingle();
        if (!lead) return json({ ok: false, reason: 'lead_not_found' }, 404);
        if (lead.status !== 'active') return json({ ok: false, reason: 'lead_inactive', message: 'Team leads must be active employees.' }, 422);
        if (lead.team_id !== teamId) return json({ ok: false, reason: 'lead_not_in_team', message: 'Team leads must belong to this team.' }, 422);
        if (lead.department_id !== team.department_id) {
          return json({ ok: false, reason: 'lead_wrong_department', message: 'Team leads must belong to the same department.' }, 422);
        }
      }

      if (leadId === team.team_lead_id) {
        return json({ ok: true, team_lead_id: leadId, already_applied: true });
      }

      const { error } = await admin.from('hr_teams').update({ team_lead_id: leadId }).eq('id', teamId);
      if (error) throw error;

      await audit('team', teamId, leadId ? 'team_lead_assigned' : 'team_lead_cleared',
        { team_lead_id: team.team_lead_id ?? null },
        { team_lead_id: leadId },
        { team_name: team.name });

      return json({ ok: true, team_lead_id: leadId });
    }

    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (error) {
    console.error('team-management failed', error);
    return json({ ok: false, reason: 'team_failed', message: String(error) }, 500);
  }
});
