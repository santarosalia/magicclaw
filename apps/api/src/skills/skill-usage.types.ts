export type SkillUsageState = "active" | "stale" | "archived";

export interface SkillUsageRecord {
  created_by: "agent" | null;
  use_count: number;
  view_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  patch_count: number;
  last_patched_at: string | null;
  created_at: string;
  state: SkillUsageState;
  pinned: boolean;
  archived_at: string | null;
}

export interface SkillUsageFile {
  version: 1;
  skills: Record<string, SkillUsageRecord>;
}

export interface CuratorState {
  last_run_at: string | null;
  last_run_summary: string | null;
  paused: boolean;
  run_count: number;
}
