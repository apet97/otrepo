export interface Env {
  SETTINGS_KV: KVNamespace;
  GITHUB_PAGES_ORIGIN: string;
  ENVIRONMENT?: string;
}

export interface OvertimeConfig {
  useProfileCapacity: boolean;
  useProfileWorkingDays: boolean;
  applyHolidays: boolean;
  applyTimeOff: boolean;
  showBillableBreakdown: boolean;
  showDecimalTime: boolean;
  enableTieredOT: boolean;
  amountDisplay: 'earned' | 'cost' | 'profit';
  overtimeBasis: 'daily' | 'weekly' | 'both';
}

export interface CalculationParams {
  dailyThreshold: number;
  weeklyThreshold: number;
  overtimeMultiplier: number;
  tier2ThresholdHours: number;
  tier2Multiplier: number;
}

export interface WorkspaceConfig {
  config: OvertimeConfig;
  calcParams: CalculationParams;
  schemaVersion?: number;
  updatedAt: string;
  updatedBy: string;
}

export interface WorkspaceOverrides {
  overrides: Record<string, unknown>;
  schemaVersion?: number;
  updatedAt: string;
  updatedBy: string;
}

export interface InstalledPayload {
  addonId: string;
  authToken: string;
  workspaceId: string;
  asUser: string;
  apiUrl?: string;
  addonUserId: string;
}

export interface JwtPayload {
  sub?: string;
  user?: string;
  workspaceId: string;
  workspaceRole?: string;
  backendUrl?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}
