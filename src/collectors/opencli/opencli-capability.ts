import type { UnifiedMaterial } from '../../types.js';

export const openCliStatuses = [
  'success',
  'partial_success',
  'login_required',
  'blocked',
  'unavailable',
  'command_failed',
] as const;

export type OpenCliStatus = typeof openCliStatuses[number];
export type BrowserPlatform = 'twitter' | 'weixin';

export interface OpenCliCommandSummary {
  args: string[];
  status: OpenCliStatus;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  cancelled: boolean;
  error: string | null;
}

export interface BrowserPlatformResult {
  platform: BrowserPlatform;
  status: OpenCliStatus;
  started_at: string;
  finished_at: string;
  commands: OpenCliCommandSummary[];
  materials: UnifiedMaterial[];
  raw_materials_count: number;
  materials_count: number;
  duplicate_materials_count: number;
  missing_fields: string[];
  error: string | null;
}

export function terminalPlatformStatus(status: OpenCliStatus): boolean {
  return status === 'login_required' || status === 'blocked' || status === 'unavailable';
}

const FAILURE_PRIORITY: OpenCliStatus[] = ['blocked', 'login_required', 'unavailable', 'command_failed', 'partial_success'];

export function summarizePlatformStatus(materialsCount: number, failures: OpenCliStatus[]): OpenCliStatus {
  if (failures.length === 0) return 'success';
  if (materialsCount > 0) return 'partial_success';
  return FAILURE_PRIORITY.find((status) => failures.includes(status)) ?? 'command_failed';
}
