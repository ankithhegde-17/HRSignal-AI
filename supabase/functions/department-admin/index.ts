// HR Signal AI :: department lifecycle (archive / unarchive / safe delete).
// HR-only. Deleting a department is allowed ONLY when it has no employees and no
// teams; otherwise the caller must archive, which preserves every historical
// record and removes the department from active lists and filters.
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
      .select('role, email, is_active')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile?.is_active || profile.role !== 'hr') {
      return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may delete or archive departments.' }, 403);
    }

    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? '');
    const departmentId = String(body.department_id ?? '');
    if (!departmentId) return json({ ok: false, reason: 'missing_department_id' }, 400);

    const { data: department } = await admin.from('hr_departments').select('id, name, code').eq('id', departmentId).maybeSingle();
    if (!department) return json({ ok: false, reason: 'department_not_found' }, 404);

    async function audit(auditAction: string, before: Row | null, after: Row | null, meta: Row = {}) {
      await admin.from('hr_audit_log').insert({
        actor_id: callerId,
        actor_email: profile.email,
        entity_type: 'department',
        entity_id: departmentId,
        action: auditAction,
        before_json: before,
        after_json: after,
        session_meta: meta,
      });
    }

    // ---------------------------------------------------------------- archive
    if (action === 'archive') {
      const { error } = await admin.from('hr_departments').update({
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_by: callerId,
      }).eq('id', departmentId);
      if (error) throw error;

      await audit('department_archived', { is_active: true }, { is_active: false }, { reason: body.reason ? String(body.reason) : null });
      return json({ ok: true, status: 'archived' });
    }

    // ---------------------------------------------------------------- unarchive
    if (action === 'unarchive') {
      const { error } = await admin.from('hr_departments').update({
        is_active: true,
        archived_at: null,
        archived_by: null,
      }).eq('id', departmentId);
      if (error) throw error;

      await audit('department_unarchived', { is_active: false }, { is_active: true });
      return json({ ok: true, status: 'active' });
    }

    // ---------------------------------------------------------------- delete
    if (action === 'delete') {
      const [{ count: employeeCount }, { count: teamCount }] = await Promise.all([
        admin.from('hr_employees').select('id', { count: 'exact', head: true }).eq('department_id', departmentId),
        admin.from('hr_teams').select('id', { count: 'exact', head: true }).eq('department_id', departmentId),
      ]);

      if ((employeeCount ?? 0) > 0 || (teamCount ?? 0) > 0) {
        return json({
          ok: false,
          reason: 'department_not_empty',
          message: 'This department still has employees or teams. Archive it instead so every record is preserved.',
          employees: employeeCount ?? 0,
          teams: teamCount ?? 0,
        }, 409);
      }

      const { error } = await admin.from('hr_departments').delete().eq('id', departmentId);
      if (error) throw error;

      await audit('department_deleted', { name: department.name, code: department.code }, null);
      return json({ ok: true, status: 'deleted' });
    }

    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (error) {
    console.error('department-admin failed', error);
    return json({ ok: false, reason: 'department_failed', message: String(error) }, 500);
  }
});
