import { Module } from "@nestjs/common";
import { UserScopeResolver } from "./user-scope.resolver.js";

@Module({
  providers: [UserScopeResolver],
  exports: [UserScopeResolver],
})
export class UserModule {}
