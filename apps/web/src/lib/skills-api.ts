/** Next.js rewrite(`/api/*`) 경유 */
const apiBase = () => "/api";

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  category: string;
}

export interface HubSkillEntry {
  name: string;
  source: string;
  identifier: string;
  install_path: string;
  installed_at: string;
  updated_at: string;
}

export interface SkillsListResponse {
  skills: SkillSummary[];
  hub: HubSkillEntry[];
}

export interface CuratorConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
}

export interface CuratorStatusResponse {
  config: CuratorConfig;
  state: {
    last_run_at: string | null;
    last_run_summary: string | null;
    paused: boolean;
    run_count: number;
  };
  agentCreatedCount: number;
  staleCount: number;
  archivedSkills: string[];
  agentSkills: Array<{
    name: string;
    state: "active" | "stale" | "archived";
    pinned: boolean;
    lastActivityAt: string | null;
    useCount: number;
    viewCount: number;
  }>;
}

export interface HubInstallResult {
  success: boolean;
  name?: string;
  path?: string;
  error?: string;
}

export async function getSkills(): Promise<SkillsListResponse> {
  const res = await fetch(`${apiBase()}/skills`);
  if (!res.ok) throw new Error("스킬 목록을 불러오지 못했습니다.");
  return res.json();
}

export async function getCuratorStatus(): Promise<CuratorStatusResponse> {
  const res = await fetch(`${apiBase()}/skills/curator/status`);
  if (!res.ok) throw new Error("Curator 상태를 불러오지 못했습니다.");
  return res.json();
}

export async function installHubSkill(body: {
  identifier: string;
  force?: boolean;
  category?: string;
}): Promise<HubInstallResult> {
  const res = await fetch(`${apiBase()}/skills/hub/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function uninstallHubSkill(name: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${apiBase()}/skills/hub/uninstall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function runCurator(dryRun = false): Promise<{ summary: string }> {
  const res = await fetch(`${apiBase()}/skills/curator/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun }),
  });
  if (!res.ok) throw new Error("Curator 실행에 실패했습니다.");
  return res.json();
}

export async function pauseCurator(): Promise<void> {
  const res = await fetch(`${apiBase()}/skills/curator/pause`, { method: "POST" });
  if (!res.ok) throw new Error("Curator 일시정지에 실패했습니다.");
}

export async function resumeCurator(): Promise<void> {
  const res = await fetch(`${apiBase()}/skills/curator/resume`, { method: "POST" });
  if (!res.ok) throw new Error("Curator 재개에 실패했습니다.");
}

export async function pinSkill(name: string, pinned: boolean): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${apiBase()}/skills/curator/pin/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  return res.json();
}

export async function restoreSkill(name: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${apiBase()}/skills/curator/restore/${encodeURIComponent(name)}`, {
    method: "POST",
  });
  return res.json();
}

export async function saveCuratorConfig(
  patch: Partial<CuratorConfig>
): Promise<CuratorConfig> {
  const res = await fetch(`${apiBase()}/skills/curator/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Curator 설정 저장에 실패했습니다.");
  const data = (await res.json()) as { config: CuratorConfig };
  return data.config;
}
