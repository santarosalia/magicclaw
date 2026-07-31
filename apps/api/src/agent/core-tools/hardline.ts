/**
 * Hardline blocks that must never run — even with force.
 * Inspired by Hermes tools/approval.py hardline patterns.
 */
const HARDLINE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*(\/|\/\*|\/\.\.)(\s|$)/,
    reason: "blocked: recursive delete of filesystem root",
  },
  {
    re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|~|\$HOME|\$\{HOME\})(\s|$|\/)/,
    reason: "blocked: recursive force-delete of home or root",
  },
  {
    re: /\brm\s+-rf\s+[~/]/,
    reason: "blocked: recursive force-delete of home or root",
  },
  {
    re: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/,
    reason: "blocked: fork bomb",
  },
  {
    re: /\bmkfs(\.\w+)?\b/,
    reason: "blocked: filesystem format",
  },
  {
    re: /\bdd\s+.*\bof=\/dev\/(sd|nvme|disk)/,
    reason: "blocked: raw disk write via dd",
  },
  {
    re: /\b(shutdown|reboot|poweroff|halt)\b/,
    reason: "blocked: system power command",
  },
];

export function findHardlineViolation(command: string): string | null {
  const normalized = command.replace(/\s+/g, " ").trim();
  for (const { re, reason } of HARDLINE_PATTERNS) {
    if (re.test(normalized)) return reason;
  }
  return null;
}
