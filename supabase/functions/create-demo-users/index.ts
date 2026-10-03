// HR Signal AI :: provision the two demo application accounts (idempotent).
// Passwords are read from the DEMO_PASSWORD secret and never appear in source or UI.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEMO_USERS = [
  { email: 'founder@hrsignal.demo', full_name: 'Amara Okafor', role: 'founder' },
  { email: 'hr@hrsignal.demo', full_name: 'Devin Rao', role: 'hr' },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const password = Deno.env.get('DEMO_PASSWORD');

    if (!url || !serviceKey || !anonKey) return json({ ok: false, reason: 'backend_not_configured' }, 500);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Account provisioning is privileged: only an already-authenticated Founder/CEO
    // may create or re-assert application accounts. This endpoint is NOT public.
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
    if (!callerProfile?.is_active || callerProfile.role !== 'founder') {
      return json(
        { ok: false, reason: 'forbidden', message: 'Account provisioning is restricted to the Founder/CEO role.' },
        403,
      );
    }

    if (!password) {
      return json(
        { ok: false, reason: 'missing_secret', secret: 'DEMO_PASSWORD' },
        400,
      );
    }

    const results: Array<Record<string, unknown>> = [];

    for (const demo of DEMO_USERS) {
      let userId: string | undefined;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: demo.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: demo.full_name, role: demo.role },
      });

      if (created?.user?.id) {
        userId = created.user.id;
      } else if (createError) {
        // Already provisioned -> resolve the existing user id.
        const { data: list, error: listError } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (listError) throw listError;
        userId = list?.users?.find((u) => u.email?.toLowerCase() === demo.email)?.id;
        if (!userId) throw createError;
      }

      if (!userId) {
        results.push({ email: demo.email, ok: false, reason: 'user_not_resolved' });
        continue;
      }

      // Re-assert the demo password so a re-run always leaves usable credentials.
      await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });

      const { error: profileError } = await admin.from('hr_profiles').upsert(
        {
          user_id: userId,
          full_name: demo.full_name,
          email: demo.email,
          role: demo.role,
          is_active: true,
        },
        { onConflict: 'user_id' },
      );
      if (profileError) throw profileError;

      results.push({ email: demo.email, role: demo.role, ok: true });
    }

    return json({ ok: true, users: results });
  } catch (error) {
    console.error('create-demo-users failed', error);
    return json({ ok: false, reason: 'unexpected_error', message: String(error) }, 500);
  }
});
