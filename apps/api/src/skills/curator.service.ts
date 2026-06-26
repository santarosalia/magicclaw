import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { getMagicClawHome } from "../common/magicclaw-home.js";
import { CuratorConfigStoreService } from "../store/curator-config-store.service.js";
import { SkillUsageService } from "./skill-usage.service.js";
import { SkillStoreService } from "./skill-store.service.js";
import type { CuratorState } from "./skill-usage.types.js";

export interface CuratorRunResult {
  ran: boolean;
  dryRun: boolean;
  staleCount: number;
  archivedCount: number;
  reactivatedCount: number;
  summary: string;
}

@Injectable()
export class CuratorService {
  private readonly logger = new Logger(CuratorService.name);
  private lastTurnFinishedAt = Date.now();

  constructor(
    private readonly configStore: CuratorConfigStoreService,
    private readonly usage: SkillUsageService,
    private readonly skillStore: SkillStoreService
  ) {}

  recordTurnFinished(): void {
    this.lastTurnFinishedAt = Date.now();
  }

  private statePath(): string {
    return join(getMagicClawHome(), "skills", ".curator_state");
  }

  loadState(): CuratorState {
    const path = this.statePath();
    if (!existsSync(path)) {
      return {
        last_run_at: null,
        last_run_summary: null,
        paused: false,
        run_count: 0,
      };
    }
    try {
      return JSON.parse(readFileSync(path, "utf8")) as CuratorState;
    } catch {
      return {
        last_run_at: null,
        last_run_summary: null,
        paused: false,
        run_count: 0,
      };
    }
  }

  private saveState(state: CuratorState): void {
    mkdirSync(join(getMagicClawHome(), "skills"), { recursive: true });
    writeFileSync(this.statePath(), JSON.stringify(state, null, 2), "utf8");
  }

  getStatus() {
    const config = this.configStore.getConfig();
    const state = this.loadState();
    const report = this.usage.getAgentCreatedReport();
    return {
      config,
      state,
      agentCreatedCount: report.length,
      staleCount: report.filter((r) => r.record.state === "stale").length,
      archivedSkills: this.usage.listArchived(),
      agentSkills: report.map((row) => ({
        name: row.name,
        state: row.record.state,
        pinned: row.record.pinned,
        lastActivityAt: row.lastActivityAt,
        useCount: row.record.use_count,
        viewCount: row.record.view_count,
      })),
    };
  }

  setPaused(paused: boolean): CuratorState {
    const state = this.loadState();
    state.paused = paused;
    this.saveState(state);
    return state;
  }

  pinSkill(name: string, pinned: boolean): { success: boolean; error?: string } {
    if (!this.usage.getRecord(name)) {
      return { success: false, error: "Skill has no usage record." };
    }
    this.usage.setPinned(name, pinned);
    return { success: true };
  }

  restoreSkill(name: string) {
    return this.usage.restoreSkill(name);
  }

  maybeRunCurator(idleSeconds?: number): CuratorRunResult | null {
    const config = this.configStore.getConfig();
    if (!config.enabled) return null;

    const state = this.loadState();
    if (state.paused) return null;

    const idle =
      idleSeconds ??
      (Date.now() - this.lastTurnFinishedAt) / 1000;
    if (idle < config.minIdleHours * 3600) return null;

    if (!state.last_run_at) {
      const seeded = { ...state, last_run_at: new Date().toISOString() };
      this.saveState(seeded);
      return null;
    }

    const lastRunMs = Date.parse(state.last_run_at);
    if (Number.isNaN(lastRunMs)) return null;
    const hoursSince = (Date.now() - lastRunMs) / (3600 * 1000);
    if (hoursSince < config.intervalHours) return null;

    return this.runReview({ dryRun: false });
  }

  applyAutomaticTransitions(dryRun: boolean): {
    staleCount: number;
    archivedCount: number;
    reactivatedCount: number;
  } {
    const config = this.configStore.getConfig();
    const now = Date.now();
    const staleCutoff = now - config.staleAfterDays * 86400 * 1000;
    const archiveCutoff = now - config.archiveAfterDays * 86400 * 1000;

    let staleCount = 0;
    let archivedCount = 0;
    let reactivatedCount = 0;

    for (const row of this.usage.getAgentCreatedReport()) {
      const { name, record } = row;
      if (record.pinned) continue;
      if (this.usage.isHubInstalled(name)) continue;

      const anchorMs =
        Date.parse(this.usage.formatActivity(record) ?? record.created_at) ||
        now;

      if (anchorMs <= archiveCutoff && record.state !== "archived") {
        if (!dryRun) {
          const dir = this.skillStore.getSkillDir(name);
          if (dir) {
            const result = this.usage.archiveSkill(name, dir);
            if (result.success) archivedCount += 1;
          }
        } else {
          archivedCount += 1;
        }
        continue;
      }

      if (anchorMs <= staleCutoff && record.state === "active") {
        if (!dryRun) this.usage.setState(name, "stale");
        staleCount += 1;
      } else if (anchorMs > staleCutoff && record.state === "stale") {
        if (!dryRun) this.usage.setState(name, "active");
        reactivatedCount += 1;
      }
    }

    return { staleCount, archivedCount, reactivatedCount };
  }

  runReview(opts?: { dryRun?: boolean }): CuratorRunResult {
    const dryRun = opts?.dryRun ?? false;
    const counts = this.applyAutomaticTransitions(dryRun);
    const summary = dryRun
      ? `[dry-run] would mark ${counts.staleCount} stale, archive ${counts.archivedCount}, reactivate ${counts.reactivatedCount}`
      : `marked ${counts.staleCount} stale, archived ${counts.archivedCount}, reactivated ${counts.reactivatedCount}`;

    if (!dryRun) {
      const state = this.loadState();
      state.last_run_at = new Date().toISOString();
      state.last_run_summary = summary;
      state.run_count += 1;
      this.saveState(state);
      this.logger.log(`Curator run: ${summary}`);
    }

    return {
      ran: true,
      dryRun,
      ...counts,
      summary,
    };
  }
}
