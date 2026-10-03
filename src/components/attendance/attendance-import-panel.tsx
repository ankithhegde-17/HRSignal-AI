import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge, ToneBadge } from "@/components/shared/badges";
import { supabase } from "@/lib/db";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatDateTime, formatFileSize } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AttendanceImport, AttendanceImportRow } from "@/lib/types";

interface ParseResult {
  ok: boolean;
  import_id?: string;
  detected_headers?: string[];
  column_mapping?: Record<string, number>;
  total_rows?: number;
  valid_rows?: number;
  invalid_rows?: number;
  duplicate_rows?: number;
  reason?: string;
  message?: string;
}

const FIELD_LABELS: Record<string, string> = {
  employee_code: "Employee code",
  attendance_date: "Attendance date",
  check_in: "Check-in time",
  check_out: "Check-out time",
  status: "Status",
  employee_name: "Employee name",
};

export function AttendanceImportPanel() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useRealtimeRefresh(
    ["hr_attendance_imports", "hr_attendance_import_rows"],
    [["attendance-imports"], ["attendance-import-rows"]],
    "hr-attendance-imports",
  );

  const { data: imports = [], isLoading: importsLoading, isError: importsError, refetch: refetchImports } = useQuery<AttendanceImport[]>({
    queryKey: ["attendance-imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as AttendanceImport[];
    },
  });

  const { data: previewRows = [], isLoading: previewLoading, refetch: refetchPreview } = useQuery<AttendanceImportRow[]>({
    queryKey: ["attendance-import-rows", importId],
    enabled: Boolean(importId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance_import_rows")
        .select("*")
        .eq("import_id", importId)
        .order("row_number")
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as AttendanceImportRow[];
    },
  });

  const currentImport = useMemo(() => imports.find((item) => item.id === importId) ?? null, [importId, imports]);

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the selected file."));
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke<ParseResult>("attendance-import", {
        body: { action: "parse", file_name: file.name, file_base64: base64 },
        headers: { "Content-Type": "application/json" },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.message ?? "The file could not be parsed.");
      return data;
    },
    onSuccess: (result) => {
      setParseError(null);
      setImportId(result.import_id ?? null);
      toast.success(
        `Parsed ${result.total_rows} rows · ${result.valid_rows} valid · ${result.invalid_rows} invalid · ${result.duplicate_rows} duplicate`,
      );
      void queryClient.invalidateQueries({ queryKey: ["attendance-imports"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance-import-rows"] });
    },
    onError: (error: Error) => {
      setParseError(error.message);
      toast.error(error.message);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; inserted: number; already_confirmed?: boolean; message?: string }>(
        "attendance-import",
        { body: { action: "confirm", import_id: id }, headers: { "Content-Type": "application/json" } },
      );
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.message ?? "The import could not be confirmed.");
      return data;
    },
    onSuccess: (result) => {
      setConfirmOpen(false);
      toast.success(
        result.already_confirmed
          ? "This import was already confirmed. No duplicate records were created."
          : `${result.inserted} attendance records confirmed and saved.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["attendance-imports"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void refetchPreview();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setParseError(null);
    parseMutation.mutate(file);
  };

  const importColumns: Column<AttendanceImport>[] = [
    {
      key: "file_name",
      header: "File",
      sortValue: (row) => row.file_name,
      cell: (row) => (
        <button
          type="button"
          className="min-w-0 text-left hover:text-primary"
          onClick={() => setImportId(row.id)}
        >
          <p className="truncate font-medium">{row.file_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.file_type?.toUpperCase() ?? "—"} · {formatFileSize(row.file_size_bytes)} · {formatDateTime(row.created_at)}
          </p>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => (
        <ToneBadge
          tone={
            row.status === "confirmed"
              ? "success"
              : row.status === "failed"
                ? "critical"
                : row.status === "preview_ready"
                  ? "workflow"
                  : "info"
          }
          showIcon
        >
          {row.status.replace(/_/g, " ")}
        </ToneBadge>
      ),
    },
    {
      key: "counts",
      header: "Rows",
      align: "right",
      sortValue: (row) => row.total_rows,
      cell: (row) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {row.total_rows} total · {row.valid_rows} valid · {row.invalid_rows} invalid · {row.duplicate_rows} dup
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "result",
      header: "Result",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.status === "failed" ? row.failure_reason ?? "Failed" : row.confirmed_at ? `Confirmed ${formatDateTime(row.confirmed_at)}` : "Awaiting confirmation"}
        </span>
      ),
      hideBelow: "lg",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => setImportId(row.id)}>
          Review
        </Button>
      ),
    },
  ];

  const previewColumns: Column<AttendanceImportRow>[] = [
    { key: "row_number", header: "Row", sortValue: (row) => row.row_number, cell: (row) => <span className="tabular-nums text-xs">{row.row_number}</span> },
    {
      key: "employee_code",
      header: "Employee code",
      sortValue: (row) => row.employee_code ?? "",
      cell: (row) => <span className="font-mono text-xs">{row.employee_code ?? "—"}</span>,
    },
    {
      key: "attendance_date",
      header: "Date",
      sortValue: (row) => row.attendance_date ?? "",
      cell: (row) => <span className="text-xs tabular-nums">{row.attendance_date ?? "—"}</span>,
    },
    {
      key: "times",
      header: "In / out",
      cell: (row) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {row.check_in_time ?? "—"} / {row.check_out_time ?? "—"}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "validation_status",
      header: "Validation",
      sortValue: (row) => row.validation_status,
      cell: (row) => (
        <ToneBadge
          tone={row.validation_status === "valid" ? "success" : row.validation_status === "duplicate" ? "warning" : "critical"}
          showIcon
        >
          {row.validation_status}
        </ToneBadge>
      ),
    },
    {
      key: "validation_errors",
      header: "Issues",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {(row.validation_errors ?? []).length > 0 ? row.validation_errors.join("; ") : "—"}
        </span>
      ),
      hideBelow: "lg",
    },
  ];

  const canConfirm = currentImport?.status === "preview_ready";

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <h2 className="text-sm font-semibold">Upload attendance export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Export from your biometric system as CSV, XLS or XLSX. Text-based PDF tables are also supported — image-only
          PDFs are rejected because they contain no readable rows.
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            handleFiles(event.dataTransfer.files);
          }}
          className={cn(
            "mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
            dragging ? "border-primary bg-primary-soft" : "border-border bg-muted/30",
          )}
        >
          <FileSpreadsheet className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Drop your attendance file here</p>
          <p className="mt-1 text-xs text-muted-foreground">CSV, XLS, XLSX or text-based PDF · up to 8 MB</p>
          <Button
            className="mt-4"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={parseMutation.isPending}
          >
            {parseMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Parsing…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                Choose file
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.xls,.xlsx,.pdf"
            className="sr-only"
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {parseError ? (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{parseError}</span>
          </div>
        ) : null}
      </section>

      {currentImport ? (
        <section className="rounded-lg border border-border bg-card shadow-card">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Import preview · {currentImport.file_name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {currentImport.total_rows} rows detected · {currentImport.valid_rows} valid ·{" "}
                {currentImport.invalid_rows} invalid · {currentImport.duplicate_rows} duplicate
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ToneBadge
                tone={currentImport.status === "confirmed" ? "success" : currentImport.status === "failed" ? "critical" : "workflow"}
                showIcon
              >
                {currentImport.status.replace(/_/g, " ")}
              </ToneBadge>
              <Button
                size="sm"
                disabled={!canConfirm || confirmMutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {canConfirm ? "Confirm valid rows" : currentImport.status === "confirmed" ? "Confirmed" : "Not ready"}
              </Button>
            </div>
          </div>

          {currentImport.status === "failed" ? (
            <div className="flex items-start gap-2 border-b border-border bg-destructive-soft px-5 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{currentImport.failure_reason}</span>
            </div>
          ) : null}

          {currentImport.column_mapping ? (
            <div className="border-b border-border px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Column mapping</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {Object.entries(currentImport.column_mapping)
                  .filter(([key]) => key !== "status_hints")
                  .map(([field, index]) => (
                    <li key={field}>
                      <ToneBadge tone={typeof index === "number" ? "primary" : "neutral"}>
                        {FIELD_LABELS[field] ?? field}
                        {typeof index === "number" ? ` ← column ${index + 1}` : ""}
                      </ToneBadge>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="p-5">
            <Tabs defaultValue="all">
              <TabsList className="mb-4 flex-wrap">
                <TabsTrigger value="all">All rows ({previewRows.length})</TabsTrigger>
                <TabsTrigger value="valid">Valid ({previewRows.filter((row) => row.validation_status === "valid").length})</TabsTrigger>
                <TabsTrigger value="invalid">Invalid ({previewRows.filter((row) => row.validation_status === "invalid").length})</TabsTrigger>
                <TabsTrigger value="duplicate">Duplicates ({previewRows.filter((row) => row.validation_status === "duplicate").length})</TabsTrigger>
              </TabsList>

              {previewLoading ? (
                <TableSkeleton rows={6} columns={5} />
              ) : (
                (["all", "valid", "invalid", "duplicate"] as const).map((filter) => {
                  const rows = filter === "all" ? previewRows : previewRows.filter((row) => row.validation_status === filter);
                  return (
                    <TabsContent key={filter} value={filter}>
                      <DataTable
                        columns={previewColumns}
                        rows={rows}
                        getRowId={(row) => row.id}
                        initialSort={{ key: "row_number", direction: "asc" }}
                        pageSize={10}
                        caption={`Import rows (${filter})`}
                        emptyState={
                          <EmptyState
                            title={`No ${filter === "all" ? "" : filter} rows`}
                            description={
                              filter === "invalid"
                                ? "Every row passed validation."
                                : filter === "duplicate"
                                  ? "No duplicate rows were detected."
                                  : "Nothing to display for this import."
                            }
                          />
                        }
                      />
                    </TabsContent>
                  );
                })
              )}
            </Tabs>
          </div>

          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Preview rows are staging records only. Attendance is written to the workforce record when you confirm, and
            confirming twice never creates duplicate entries.
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Import history</h2>
        {importsError ? (
          <ErrorState onRetry={() => void refetchImports()} />
        ) : (
          <DataTable
            columns={importColumns}
            rows={imports}
            getRowId={(row) => row.id}
            initialSort={{ key: "file_name", direction: "desc" }}
            pageSize={8}
            caption="Attendance import history"
            isLoading={importsLoading}
            emptyState={
              <EmptyState
                title="No imports yet"
                description="Upload the first biometric export to build attendance analytics."
              />
            }
          />
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm and save attendance?"
        description={`${currentImport?.valid_rows ?? 0} validated rows will be written to attendance. Rows that are invalid or duplicate are skipped, so confirming again cannot create duplicates.`}
        confirmLabel="Confirm import"
        busy={confirmMutation.isPending}
        onConfirm={() => importId && confirmMutation.mutate(importId)}
      />
    </div>
  );
}

/** Compact status legend used by the attendance dashboard. */
export function ImportStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <StatusBadge value="present" labels={{ present: "Present" }} tones={{ present: "success" }} />
      <StatusBadge value="late" labels={{ late: "Late" }} tones={{ late: "warning" }} />
      <StatusBadge value="absent" labels={{ absent: "Absent" }} tones={{ absent: "critical" }} />
      <StatusBadge value="leave" labels={{ leave: "Leave" }} tones={{ leave: "info" }} />
    </div>
  );
}
