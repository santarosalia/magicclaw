import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getWorkspaceRoot,
  isPathInside,
  resolveToolPath,
} from "./workspace.js";

describe("core-tools workspace", () => {
  const prevWorkspace = process.env.MAGICCLAW_WORKSPACE;

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.MAGICCLAW_WORKSPACE;
    else process.env.MAGICCLAW_WORKSPACE = prevWorkspace;
  });

  it("uses MAGICCLAW_WORKSPACE when set", () => {
    const root = join(tmpdir(), `mc-ws-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    process.env.MAGICCLAW_WORKSPACE = root;
    expect(getWorkspaceRoot()).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves relative paths against workspace", () => {
    const root = join(tmpdir(), `mc-ws-rel-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    expect(resolveToolPath("foo/bar.txt", root)).toBe(join(root, "foo/bar.txt"));
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps absolute paths absolute", () => {
    const abs = join(tmpdir(), "abs-file.txt");
    expect(resolveToolPath(abs, "/tmp")).toBe(abs);
  });

  it("detects path containment", () => {
    const root = "/tmp/workspace";
    expect(isPathInside("/tmp/workspace/a.txt", root)).toBe(true);
    expect(isPathInside("/tmp/other/a.txt", root)).toBe(false);
  });
});

describe("hardline command guard", () => {
  // imported after define to keep test file self-contained once guard exists
  it("blocks wipe-home and fork-bomb style commands", async () => {
    const { findHardlineViolation } = await import("./hardline.js");
    expect(findHardlineViolation("rm -rf /")).toMatch(/blocked/i);
    expect(findHardlineViolation("rm -rf ~")).toMatch(/blocked/i);
    expect(findHardlineViolation(":(){ :|:& };:")).toMatch(/blocked/i);
    expect(findHardlineViolation("echo hello")).toBeNull();
  });
});

describe("patch replace", () => {
  it("replaces a unique string in a file", async () => {
    const { applyReplacePatch } = await import("./patch-ops.js");
    const dir = join(tmpdir(), `mc-patch-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "a.txt");
    writeFileSync(file, "hello world\n", "utf8");
    const result = applyReplacePatch(file, "world", "magicclaw");
    expect(result.ok).toBe(true);
    expect(result.content).toContain("hello magicclaw");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when old_string is not unique without replace_all", async () => {
    const { applyReplacePatch } = await import("./patch-ops.js");
    const dir = join(tmpdir(), `mc-patch2-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "a.txt");
    writeFileSync(file, "aa\naa\n", "utf8");
    const result = applyReplacePatch(file, "aa", "bb");
    expect(result.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
