import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { CuratorService } from "./curator.service.js";
import { SkillsHubService } from "./skills-hub.service.js";
import { SkillStoreService } from "./skill-store.service.js";
import { CuratorConfigStoreService } from "../store/curator-config-store.service.js";
import type { CuratorConfig } from "./curator-config.js";

@Controller("skills")
export class SkillsController {
  constructor(
    private readonly skillStore: SkillStoreService,
    private readonly skillsHub: SkillsHubService,
    private readonly curator: CuratorService,
    private readonly curatorConfig: CuratorConfigStoreService
  ) {}

  @Get()
  list() {
    return {
      skills: this.skillStore.listSkills(),
      hub: this.skillsHub.listInstalled(),
    };
  }

  @Post("hub/install")
  async installHub(
    @Body() body: { identifier: string; force?: boolean; category?: string }
  ) {
    return this.skillsHub.install(body.identifier, {
      force: body.force,
      category: body.category,
    });
  }

  @Post("hub/uninstall")
  uninstallHub(@Body() body: { name: string }) {
    return this.skillsHub.uninstall(body.name);
  }

  @Get("curator/status")
  curatorStatus() {
    return this.curator.getStatus();
  }

  @Post("curator/run")
  curatorRun(@Body() body?: { dryRun?: boolean }) {
    return this.curator.runReview({ dryRun: body?.dryRun });
  }

  @Post("curator/pause")
  curatorPause() {
    return this.curator.setPaused(true);
  }

  @Post("curator/resume")
  curatorResume() {
    return this.curator.setPaused(false);
  }

  @Post("curator/pin/:name")
  curatorPin(
    @Param("name") name: string,
    @Body() body: { pinned: boolean }
  ) {
    return this.curator.pinSkill(name, body.pinned ?? true);
  }

  @Post("curator/restore/:name")
  curatorRestore(@Param("name") name: string) {
    return this.curator.restoreSkill(name);
  }

  @Post("curator/config")
  saveCuratorConfig(@Body() body: Partial<CuratorConfig>) {
    const next = { ...this.curatorConfig.getConfig(), ...body };
    this.curatorConfig.saveConfig(next);
    return { ok: true, config: next };
  }
}
