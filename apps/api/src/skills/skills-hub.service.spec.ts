import { SkillsHubService } from "./skills-hub.service.js";

describe("SkillsHubService", () => {
  const hub = new SkillsHubService();

  it("parses github identifiers", () => {
    expect(hub.parseGithubIdentifier("hermes-agent/skills/github/SKILL.md")).toEqual({
      owner: "hermes-agent",
      repo: "skills",
      branch: "main",
      path: "github/SKILL.md",
    });

    expect(
      hub.parseGithubIdentifier(
        "https://github.com/foo/bar/tree/develop/packages/my-skill"
      )
    ).toEqual({
      owner: "foo",
      repo: "bar",
      branch: "develop",
      path: "packages/my-skill",
    });
  });
});
