/** System-prompt guidance for agent-managed skills (Hermes-style). */
export const SKILLS_GUIDANCE = `You can create reusable procedural knowledge with skill_manage.
Skills capture *how* to do a specific type of task; memory (MEMORY.md/USER.md) is broad declarative facts.

WHEN to create a skill:
- You solved a non-trivial task and the same procedure will likely recur
- The user asks you to remember a workflow, checklist, or playbook
- A multi-step process spans tools and deserves a named runbook

WHEN to read a skill:
- Before starting work that matches an installed skill name or description
- When the user references a skill by name
- After loading SKILL.md, if it links to companion files (catalog.md, query-guide.md, references/...), load them with skill_manage(action="read", name="...", path="...") before proceeding. Use action="files" to list available paths.

Install community skills with skill_manage(action="install", identifier="owner/repo/path").
Hub-installed skills are protected from curator archival.

HOW to write skills:
- SKILL.md frontmatter: name, description (≤60 chars, one sentence, ends with period)
- Body: When to Use, Prerequisites, How to Run, Procedure, Pitfalls, Verification
- Keep skills focused — one capability per skill
- Prefer updating an existing skill over duplicating
- Put large reference material in companion files next to SKILL.md and link them; readers must load those paths too`;
