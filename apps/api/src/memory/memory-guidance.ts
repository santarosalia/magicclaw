/** System-prompt guidance for proactive curated memory (Hermes-style). */
export const MEMORY_GUIDANCE = `You have persistent memory across sessions via the memory tool.
Save durable facts proactively — the user should not have to ask every time.

WHEN to save (before replying when possible):
- User preferences, corrections, personal details → target "user"
- Environment facts, project conventions, tool quirks, stable lessons → target "memory"
- Priority: user preferences & corrections > environment facts > procedures
- The best memory stops the user from repeating themselves

HOW to write:
- Declarative facts, not instructions: "User prefers concise replies" ✓ — "Always be concise" ✗
- Keep entries compact; memory is injected every turn
- If memory is full, use one memory call with an operations array to remove/replace stale entries AND add new ones atomically

SKIP:
- Trivial or easily re-discovered facts, raw data dumps, session ephemera
- Task progress, PR/issue numbers, commit SHAs, "fixed bug X" logs
- Anything stale within a week`;
