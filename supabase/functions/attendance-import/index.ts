// HR Signal AI :: attendance import pipeline.
// Upload -> secure parse -> column mapping -> row validation -> preview -> transactional confirm.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'hr-attendance-imports';
const MAX_BYTES = 8 * 1024 * 1024;

const CANONICAL_STATUSES = ['present', 'absent', 'late', 'half-day', 'leave', 'holiday'];

const HEADER_SYNONYMS: Record<string, string[]> = {
  employee_code: ['employee code', 'employeecode', 'emp code', 'empcode', 'employee id', 'employeeid', 'emp id', 'empid', 'staff id', 'staffid', 'code', 'employee no', 'employeeno'],
  attendance_date: ['date', 'attendance date', 'attendancedate', 'punch date', 'punchdate', 'day', 'work date'],
  check_in: ['check in', 'checkin', 'check-in', 'in time', 'intime', 'first in', 'firstin', 'punch in', 'punchin', 'time in'],
  check_out: ['check out', 'checkout', 'check-out', 'out time', 'outtime', 'last out', 'lastout', 'punch out', 'punchout', 'time out'],
  status: ['status', 'attendance status', 'attendancestatus', 'state'],
  employee_name: ['name', 'employee name', 'employeename', 'full name'],
};

type Row = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mapHeaders(headers: string[]) {
  const mapping: Record<string, number> = {};
  headers.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (mapping[field] !== undefined) continue;
      if (synonyms.includes(normalized.replace(/\s+/g, '')) || synonyms.includes(normalized)) {
        mapping[field] = index;
      }
    }
  });
  return mapping;
}

// RFC-4180-ish CSV parser (handles quoted fields and embedded commas).
function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char === '\r') continue;
    else field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function detectDelimiter(text: string) {
  const sample = text.split('\n').slice(0, 5).join('\n');
  const counts = { ',': (sample.match(/,/g) ?? []).length, ';': (sample.match(/;/g) ?? []).length, '\t': (sample.match(/\t/g) ?? []).length };
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as string;
}

function parseDateValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Guard against silent roll-over (e.g. 31 February or month 13 turning into a
  // different date), which would write the wrong day into attendance.
  const build = (year: number, month: number, day: number): string | null => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(d.getTime())) return null;
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return d.toISOString().slice(0, 10);
  };

  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]));

  match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (match) {
    const [, a, b, y] = match;
    let year = Number(y);
    if (year < 100) year += 2000;
    let day = Number(a);
    let month = Number(b);
    if (Number(a) <= 12 && Number(b) > 12) { day = Number(b); month = Number(a); }
    return build(year, month, day);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return build(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function combineDateTime(dateIso: string, timeValue: string): string | null {
  if (!timeValue) return null;
  const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCHours(hours, minutes, seconds, 0);
  return d.toISOString();
}

function normalizeStatus(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (CANONICAL_STATUSES.includes(v)) return v;
  if (['p', 'pres', 'present '].includes(v)) return 'present';
  if (['a', 'abs', 'absent '].includes(v)) return 'absent';
  if (['l', 'lt', 'late '].includes(v)) return 'late';
  if (['hd', 'half day', 'halfday', 'half-day '].includes(v)) return 'half-day';
  if (['lv', 'leave ', 'on leave'].includes(v)) return 'leave';
  if (['holiday', 'hol', 'public holiday'].includes(v)) return 'holiday';
  return null;
}

async function ensureBucket(admin: ReturnType<typeof createClient>) {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
      return json({ ok: false, reason: 'forbidden', message: 'Only the HR role may import attendance.' }, 403);
    }

    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? 'parse');

    // ------------------------------------------------------------------ parse
    if (action === 'parse') {
      const fileName = String(body.file_name ?? '').trim();
      const fileBase64 = String(body.file_base64 ?? '');
      if (!fileName || !fileBase64) return json({ ok: false, reason: 'missing_file' }, 400);

      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      if (!['csv', 'txt', 'xlsx', 'xls', 'pdf'].includes(extension)) {
        return json({ ok: false, reason: 'unsupported_type', message: 'Supported formats are CSV, XLS, XLSX and text-based PDF.' }, 400);
      }

      const bytes = bytesFromBase64(fileBase64);
      if (bytes.length === 0) return json({ ok: false, reason: 'empty_file' }, 400);
      if (bytes.length > MAX_BYTES) return json({ ok: false, reason: 'file_too_large', message: 'Files must be 8 MB or smaller.' }, 400);

      await ensureBucket(admin);
      const storagePath = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType: extension === 'pdf' ? 'application/pdf'
          : extension === 'csv' || extension === 'txt' ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true,
      });
      if (uploadError) throw uploadError;

      const { data: importRecord, error: importError } = await admin
        .from('hr_attendance_imports')
        .insert({
          file_name: fileName,
          file_path: storagePath,
          file_type: extension,
          file_size_bytes: bytes.length,
          uploaded_by: callerId,
          status: 'uploaded',
        })
        .select('id')
        .single();
      if (importError) throw importError;
      const importId = importRecord.id as string;

      // ---- extract a grid of string cells from the uploaded file
      let grid: string[][] = [];
      let failureReason: string | null = null;

      try {
        if (extension === 'csv' || extension === 'txt') {
          const text = new TextDecoder().decode(bytes);
          grid = parseDelimited(text, detectDelimiter(text));
        } else if (extension === 'xlsx' || extension === 'xls') {
          const XLSX = await import('https://esm.sh/xlsx@0.18.5');
          const workbook = XLSX.read(bytes, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
          grid = rows.map((r) => r.map((c) => String(c ?? '')));
        } else {
          const { extractText, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
          const pdf = await getDocumentProxy(bytes);
          const { text } = await extractText(pdf, { mergePages: true });
          const flat = Array.isArray(text) ? text.join('\n') : String(text ?? '');
          const lines = flat.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
          if (lines.join('').replace(/\s/g, '').length < 20) {
            failureReason = 'Image-only PDF: no extractable text layer. Export CSV/XLSX or a text-based PDF instead.';
          } else {
            grid = lines.map((line) => line.split(/\s{2,}|\t|,(?=\S)/).map((c) => c.trim()));
          }
        }
      } catch (parseError) {
        failureReason = `Could not read the file: ${String(parseError instanceof Error ? parseError.message : parseError)}`;
      }

      if (failureReason) {
        await admin.from('hr_attendance_imports').update({ status: 'failed', failure_reason: failureReason }).eq('id', importId);
        await admin.from('hr_audit_log').insert({
          actor_id: callerId, actor_email: profile.email, entity_type: 'attendance_import', entity_id: importId,
          action: 'import_failed', after_json: { reason: failureReason }, session_meta: { file_name: fileName },
        });
        await admin.from('hr_notifications').insert({
          user_id: callerId, title: 'Attendance import failed', body: `${fileName}: ${failureReason}`, type: 'warning',
          entity_type: 'attendance_import', entity_id: importId, link: '/attendance',
        });
        return json({ ok: false, reason: 'unreadable_file', message: failureReason, import_id: importId }, 422);
      }

      if (grid.length < 2) {
        const reason = 'The file has no data rows after the header row.';
        await admin.from('hr_attendance_imports').update({ status: 'failed', failure_reason: reason }).eq('id', importId);
        return json({ ok: false, reason: 'no_rows', message: reason, import_id: importId }, 422);
      }

      const headers = grid[0].map((h) => h.trim());
      const mapping = mapHeaders(headers);
      if (mapping.employee_code === undefined || mapping.attendance_date === undefined) {
        const reason = 'Required columns were not detected. Include an employee code column and an attendance date column.';
        await admin.from('hr_attendance_imports').update({ status: 'failed', failure_reason: reason, column_mapping: mapping }).eq('id', importId);
        return json({ ok: false, reason: 'missing_columns', message: reason, detected_headers: headers, import_id: importId }, 422);
      }

      const { data: employeeRows, error: employeesError } = await admin.from('hr_employees').select('id, code, full_name');
      if (employeesError) throw employeesError;
      const employeeByCode = new Map((employeeRows ?? []).map((e) => [String(e.code).toUpperCase(), e]));

      const { data: existingAttendance, error: attendanceError } = await admin
        .from('hr_attendance')
        .select('employee_id, attendance_date');
      if (attendanceError) throw attendanceError;
      const existingKeys = new Set((existingAttendance ?? []).map((a) => `${a.employee_id}|${a.attendance_date}`));

      const seenInFile = new Set<string>();
      const stagingRows: Row[] = [];
      let validCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;

      for (let r = 1; r < grid.length; r += 1) {
        const row = grid[r];
        const rawValues: Record<string, string> = {};
        headers.forEach((h, i) => { rawValues[h || `col_${i}`] = row[i] ?? ''; });

        const errors: string[] = [];
        const rawCode = (row[mapping.employee_code] ?? '').trim();
        const rawDate = (row[mapping.attendance_date] ?? '').trim();
        const rawCheckIn = mapping.check_in !== undefined ? (row[mapping.check_in] ?? '').trim() : '';
        const rawCheckOut = mapping.check_out !== undefined ? (row[mapping.check_out] ?? '').trim() : '';
        const rawStatus = mapping.status !== undefined ? (row[mapping.status] ?? '').trim() : '';

        const employee = rawCode ? employeeByCode.get(rawCode.toUpperCase()) : undefined;
        if (!rawCode) errors.push('Missing employee code');
        else if (!employee) errors.push(`Unknown employee code "${rawCode}"`);

        const dateIso = parseDateValue(rawDate);
        if (!rawDate) errors.push('Missing attendance date');
        else if (!dateIso) errors.push(`Unreadable date "${rawDate}"`);

        let validationStatus: 'valid' | 'invalid' | 'duplicate' = 'valid';
        if (errors.length > 0) { validationStatus = 'invalid'; invalidCount += 1; }
        else if (employee && dateIso) {
          const key = `${employee.id}|${dateIso}`;
          if (seenInFile.has(key)) { validationStatus = 'duplicate'; duplicateCount += 1; errors.push('Duplicate row for the same employee and date within this file'); }
          else if (existingKeys.has(key)) { validationStatus = 'duplicate'; duplicateCount += 1; errors.push('Attendance already recorded for this employee and date'); }
          else { seenInFile.add(key); validCount += 1; }
        }

        stagingRows.push({
          import_id: importId,
          row_number: r,
          raw_values: rawValues,
          employee_code: rawCode || null,
          employee_id: employee?.id ?? null,
          attendance_date: dateIso,
          check_in_time: rawCheckIn || null,
          check_out_time: rawCheckOut || null,
          validation_status: validationStatus,
          validation_errors: errors,
          _status_hint: rawStatus,
        });
      }

      // Status hint is only used during confirm; keep the staging table clean.
      const stagingForDb = stagingRows.map(({ _status_hint, ...rest }) => rest);
      const statusHints: Record<string, string> = {};
      stagingRows.forEach((row, idx) => { statusHints[String(idx)] = String(row._status_hint ?? ''); });

      for (let i = 0; i < stagingForDb.length; i += 300) {
        const { error } = await admin.from('hr_attendance_import_rows').insert(stagingForDb.slice(i, i + 300));
        if (error) throw new Error(`hr_attendance_import_rows: ${error.message}`);
      }

      await admin.from('hr_attendance_imports').update({
        status: 'preview_ready',
        total_rows: stagingRows.length,
        valid_rows: validCount,
        invalid_rows: invalidCount,
        duplicate_rows: duplicateCount,
        column_mapping: { ...mapping, status_hints: statusHints },
      }).eq('id', importId);

      await admin.from('hr_audit_log').insert({
        actor_id: callerId, actor_email: profile.email, entity_type: 'attendance_import', entity_id: importId,
        action: 'import_parsed',
        after_json: { total: stagingRows.length, valid: validCount, invalid: invalidCount, duplicates: duplicateCount },
        session_meta: { file_name: fileName, mapping },
      });

      return json({
        ok: true,
        import_id: importId,
        detected_headers: headers,
        column_mapping: mapping,
        total_rows: stagingRows.length,
        valid_rows: validCount,
        invalid_rows: invalidCount,
        duplicate_rows: duplicateCount,
      });
    }

    // ------------------------------------------------------------------ confirm
    if (action === 'confirm') {
      const importId = String(body.import_id ?? '');
      if (!importId) return json({ ok: false, reason: 'missing_import_id' }, 400);

      const { data: importRecord, error: importFetchError } = await admin
        .from('hr_attendance_imports').select('*').eq('id', importId).maybeSingle();
      if (importFetchError) throw importFetchError;
      if (!importRecord) return json({ ok: false, reason: 'import_not_found' }, 404);
      if (importRecord.status === 'confirmed') {
        return json({ ok: true, already_confirmed: true, inserted: 0, import_id: importId });
      }
      if (importRecord.status !== 'preview_ready') {
        return json({ ok: false, reason: 'not_ready', message: 'This import has no validated preview to confirm.' }, 409);
      }

      const { data: validRows, error: validError } = await admin
        .from('hr_attendance_import_rows')
        .select('id, employee_id, attendance_date, check_in_time, check_out_time, row_number')
        .eq('import_id', importId)
        .eq('validation_status', 'valid');
      if (validError) throw validError;

      const hints = (importRecord.column_mapping as Record<string, unknown> | null)?.status_hints as Record<string, string> | undefined;
      const hintList = Object.entries(hints ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v);

      const attendancePayload = (validRows ?? []).map((row) => {
        const dateIso = row.attendance_date as string;
        const checkIn = row.check_in_time ? combineDateTime(dateIso, row.check_in_time as string) : null;
        const checkOut = row.check_out_time ? combineDateTime(dateIso, row.check_out_time as string) : null;

        const hint = hintList.find((_, idx) => idx === (row.row_number as number) - 1) ?? '';
        let status = normalizeStatus(hint);
        if (!status) {
          if (!checkIn && !checkOut) status = 'absent';
          else {
            const inDate = new Date(checkIn ?? `${dateIso}T09:00:00Z`);
            const hour = inDate.getUTCHours();
            const minute = inDate.getUTCMinutes();
            status = hour > 9 || (hour === 9 && minute > 30) ? 'late' : 'present';
          }
        }

        let workingMinutes: number | null = null;
        if (checkIn && checkOut) {
          workingMinutes = Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000));
        } else if (status === 'half-day') workingMinutes = 240;

        return {
          employee_id: row.employee_id,
          attendance_date: dateIso,
          check_in: checkIn,
          check_out: checkOut,
          working_minutes: workingMinutes,
          overtime_minutes: workingMinutes && workingMinutes > 480 ? workingMinutes - 480 : 0,
          status,
          import_source: importId,
          notes: 'Imported from biometric export',
        };
      });

      let inserted = 0;
      for (let i = 0; i < attendancePayload.length; i += 400) {
        const slice = attendancePayload.slice(i, i + 400);
        const { data, error } = await admin
          .from('hr_attendance')
          .upsert(slice, { onConflict: 'employee_id,attendance_date', ignoreDuplicates: true })
          .select('id');
        if (error) throw new Error(`hr_attendance: ${error.message}`);
        inserted += data?.length ?? 0;
      }

      await admin.from('hr_attendance_imports').update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        valid_rows: inserted,
      }).eq('id', importId);

      await admin.from('hr_audit_log').insert({
        actor_id: callerId, actor_email: profile.email, entity_type: 'attendance_import', entity_id: importId,
        action: 'import_confirmed',
        before_json: { status: 'preview_ready' },
        after_json: { status: 'confirmed', inserted },
        session_meta: { file_name: importRecord.file_name },
      });

      await admin.from('hr_notifications').insert({
        user_id: callerId,
        title: 'Attendance import confirmed',
        body: `${importRecord.file_name}: ${inserted} attendance records saved.`,
        type: 'import',
        entity_type: 'attendance_import',
        entity_id: importId,
        link: '/attendance',
      });

      return json({ ok: true, inserted, import_id: importId, confirmed_rows: attendancePayload.length });
    }

    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (error) {
    console.error('attendance-import failed', error);
    return json({ ok: false, reason: 'import_failed', message: String(error) }, 500);
  }
});
