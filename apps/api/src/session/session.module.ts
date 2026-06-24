import { Module } from "@nestjs/common";
import { SessionService } from "./session.service.js";
import { SessionDbService } from "./session-db.service.js";
import { SessionController } from "./session.controller.js";

@Module({
  controllers: [SessionController],
  providers: [SessionDbService, SessionService],
  exports: [SessionService, SessionDbService],
})
export class SessionModule {}
