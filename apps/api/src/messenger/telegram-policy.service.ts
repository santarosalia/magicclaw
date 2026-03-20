import { Injectable } from "@nestjs/common";
import { MessengerStoreService } from "../store/messenger-store.service.js";

@Injectable()
export class TelegramPolicyService {
  constructor(private readonly messengerStore: MessengerStoreService) {}

  isAllowed(fromId: string): { allowed: boolean; shouldAutoPair: boolean } {
    const cfg = this.messengerStore.getTelegramConfig();
    switch (cfg.dmPolicy) {
      case "disabled":
        return { allowed: false, shouldAutoPair: false };
      case "open":
        return { allowed: true, shouldAutoPair: false };
      case "allowlist":
        return { allowed: cfg.allowFrom.includes(fromId), shouldAutoPair: false };
      case "pairing":
        if (cfg.pairedFrom.includes(fromId)) {
          return { allowed: true, shouldAutoPair: false };
        }
        if ((cfg.pairedFrom ?? []).length === 0) {
          return { allowed: false, shouldAutoPair: true };
        }
        return { allowed: false, shouldAutoPair: false };
    }
  }
}
