export interface CuratorConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
}

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  enabled: true,
  intervalHours: 168,
  minIdleHours: 2,
  staleAfterDays: 30,
  archiveAfterDays: 90,
};
