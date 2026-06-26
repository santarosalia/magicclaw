import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { SkillStoreService } from "./skill-store.service.js";
import type { SkillsHubService } from "./skills-hub.service.js";

const SKILL_MANAGE_DESCRIPTION = `Create, read, update, and delete agent skills — reusable procedural playbooks stored in ~/.magicclaw/skills/.

ACTIONS:
- list (default): installed skills with names and descriptions
- read: load full SKILL.md by name
- create: new skill (name, description, content; optional category)
- edit: full SKILL.md rewrite
- patch: find-and-replace in SKILL.md (old_text → new_text)
- delete: remove agent-created skill directory (not hub skills)
- install: install from GitHub (identifier: owner/repo or owner/repo/path or tree URL)
- uninstall: remove hub-installed skill
- hub_list: list hub-installed skills from lock file

Skills are procedural memory ("how to deploy X"); use memory tool for declarative facts ("user prefers Korean").`;

export function createSkillManageTool(
  skillStore: SkillStoreService,
  skillsHub: SkillsHubService
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "skill_manage",
    description: SKILL_MANAGE_DESCRIPTION,
    schema: z.object({
      action: z
        .enum([
          "list",
          "read",
          "create",
          "edit",
          "patch",
          "delete",
          "install",
          "uninstall",
          "hub_list",
        ])
        .optional()
        .default("list"),
      name: z.string().optional().describe("Skill name for read/edit/patch/delete/uninstall."),
      description: z
        .string()
        .optional()
        .describe("One-sentence description for create."),
      content: z
        .string()
        .optional()
        .describe("SKILL.md body for create, or full file for edit."),
      category: z
        .string()
        .optional()
        .describe("Directory category for create/install (default: user/hub)."),
      identifier: z
        .string()
        .optional()
        .describe("GitHub source for install: owner/repo or owner/repo/path."),
      force: z
        .boolean()
        .optional()
        .describe("Reinstall hub skill when already present."),
      old_text: z.string().optional().describe("Patch: text to find."),
      new_text: z.string().optional().describe("Patch: replacement text."),
    }),
    func: async ({
      action = "list",
      name,
      description,
      content,
      category,
      identifier,
      force,
      old_text,
      new_text,
    }) => {
      switch (action) {
        case "list":
          return JSON.stringify({ skills: skillStore.listSkills() });
        case "hub_list":
          return JSON.stringify({ installed: skillsHub.listInstalled() });
        case "read":
          if (!name?.trim()) {
            return JSON.stringify({ success: false, error: "name is required." });
          }
          return JSON.stringify(skillStore.readSkill(name));
        case "install": {
          if (!identifier?.trim()) {
            return JSON.stringify({
              success: false,
              error: "install requires identifier (owner/repo or GitHub tree URL).",
            });
          }
          return JSON.stringify(
            await skillsHub.install(identifier, { force, category })
          );
        }
        case "uninstall":
          if (!name?.trim()) {
            return JSON.stringify({ success: false, error: "name is required." });
          }
          return JSON.stringify(skillsHub.uninstall(name));
        case "create": {
          if (!name?.trim() || !description?.trim() || !content?.trim()) {
            return JSON.stringify({
              success: false,
              error: "create requires name, description, and content.",
            });
          }
          return JSON.stringify(
            skillStore.createSkill({ name, description, content, category })
          );
        }
        case "edit":
          if (!name?.trim() || !content?.trim()) {
            return JSON.stringify({
              success: false,
              error: "edit requires name and content.",
            });
          }
          return JSON.stringify(skillStore.editSkill(name, content));
        case "patch":
          if (!name?.trim() || old_text === undefined || new_text === undefined) {
            return JSON.stringify({
              success: false,
              error: "patch requires name, old_text, and new_text.",
            });
          }
          return JSON.stringify(skillStore.patchSkill(name, old_text, new_text));
        case "delete":
          if (!name?.trim()) {
            return JSON.stringify({ success: false, error: "name is required." });
          }
          return JSON.stringify(skillStore.deleteSkill(name));
        default:
          return JSON.stringify({ success: false, error: "Unknown action." });
      }
    },
  });
}
