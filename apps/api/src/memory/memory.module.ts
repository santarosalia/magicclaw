import { Module } from "@nestjs/common";
import { StoreModule } from "../store/store.module.js";
import { MemoryManagerService } from "./memory-manager.service.js";
import { MemoryController } from "./memory.controller.js";

@Module({
  imports: [StoreModule],
  controllers: [MemoryController],
  providers: [MemoryManagerService],
  exports: [MemoryManagerService],
})
export class MemoryModule {}
