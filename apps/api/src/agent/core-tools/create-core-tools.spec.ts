import { createCoreTools, CORE_TOOL_NAMES } from "./create-core-tools.js";

describe("createCoreTools", () => {
  it("exposes Hermes waist tool names", () => {
    const tools = createCoreTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...CORE_TOOL_NAMES].sort());
    expect(names).not.toContain("sh");
  });
});
