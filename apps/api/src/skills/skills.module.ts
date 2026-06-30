import { Module } from "@nestjs/common";
import { SkillStoreService } from "./skill-store.service.js";
import { SkillUsageService } from "./skill-usage.service.js";
import { CuratorService } from "./curator.service.js";
import { SkillsHubService } from "./skills-hub.service.js";
import { SkillsController } from "./skills.controller.js";
import { StoreModule } from "../store/store.module.js";

@Module({
  imports: [StoreModule],
  controllers: [SkillsController],
  providers: [
    SkillUsageService,
    SkillStoreService,
    CuratorService,
    SkillsHubService,
  ],
  exports: [
    SkillStoreService,
    SkillUsageService,
    CuratorService,
    SkillsHubService,
  ],
})
export class SkillsModule {}
