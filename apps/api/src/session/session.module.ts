import { Module } from "@nestjs/common";
import { SessionService } from "./session.service.js";
import { SessionDbService } from "./session-db.service.js";
import { SessionController } from "./session.controller.js";
import { SessionSearchService } from "./session-search.service.js";

@Module({
  controllers: [SessionController],
  providers: [SessionDbService, SessionService, SessionSearchService],
  exports: [SessionService, SessionDbService, SessionSearchService],
})
export class SessionModule {}
