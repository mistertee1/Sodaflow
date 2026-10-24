/** Browser-safe API contracts; no server SDK or financial sources. */
export type ScheduledExportKind = 'accounting' | 'auditor' | 'company';
export interface ExportScheduleInput {
  name: string; kind: ScheduledExportKind; cadence: 'daily' | 'weekly' | 'monthly';
  timezone: string; time: string; weekday?: number; month_day?: number;
  start_date: string; end_date?: string;
  period_kind: 'previous_day' | 'previous_month' | 'month_to_date' | 'full';
  retention_hours: number; active: boolean;
}
export type ExportScheduleUpdates = Partial<Omit<ExportScheduleInput, 'weekday' | 'month_day' | 'end_date'>> & {
  weekday?: number | null; month_day?: number | null; end_date?: string | null;
};
export interface ExportScheduleView extends ExportScheduleInput {
  schema_version: 1; id: string; org_id: string; revision: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string; next_run_at: string | null;
  last_dispatch_at?: string; last_dispatch_outcome?: string;
}
export interface ExportScheduleList {
  org_id: string; generated_at: string; schedules: ExportScheduleView[];
  allowed_kinds: ScheduledExportKind[]; execution_enabled: false;
}
export interface ExportScheduleMutation { org_id: string; schedule: ExportScheduleView; execution_enabled: false; }
export interface ExportJobView {
  id: string; org_id: string; collection: 'accounting_export_jobs' | 'company_export_jobs';
  kind: ScheduledExportKind; origin: 'manual' | 'scheduled'; requested_by: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  created_at: string; updated_at: string; expires_at?: string;
  schedule_id?: string; policy_revision?: number; scheduled_for?: string;
  filename?: string; byte_size?: number; progress: number; download_available: boolean;
}
export interface ExportJobHistory { org_id: string; generated_at: string; jobs: ExportJobView[]; limit: 100; }
export interface ExportDownload { url: string; expires_at: string; }
