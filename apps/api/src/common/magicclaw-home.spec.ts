import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  expandUserPath,
  getMagicClawHome,
  getMemoriesDir,
  sanitizePathSegment,
} from "./magicclaw-home.js";

describe("magicclaw-home", () => {
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(() => {
    prevHome = process.env.MAGICCLAW_HOME;
    prevUserProfile = process.env.USERPROFILE;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.MAGICCLAW_HOME;
    else process.env.MAGICCLAW_HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  });

  it("expands ~/.magicclaw to an absolute home path", () => {
    expect(expandUserPath("~/.magicclaw")).toBe(
      resolve(join(homedir(), ".magicclaw"))
    );
  });

  it("expands %USERPROFILE%\\.magicclaw on Windows-style env paths", () => {
    process.env.USERPROFILE = "C:\\Users\\tester";
    const expanded = expandUserPath("%USERPROFILE%\\.magicclaw");
    expect(expanded).not.toContain("%USERPROFILE%");
    expect(expanded.replace(/\\/g, "/")).toContain("Users/tester/.magicclaw");
  });

  it("resolves MAGICCLAW_HOME when it uses a tilde prefix", () => {
    process.env.MAGICCLAW_HOME = "~/.magicclaw";
    expect(getMagicClawHome()).toBe(resolve(join(homedir(), ".magicclaw")));
  });

  it("sanitizes scoped user ids for cross-platform memory directories", () => {
    const userId = "web:c1f48a64-5bbb-4a4f-bed1-0a24d39f061b";
    expect(sanitizePathSegment(userId)).toBe(
      "web_c1f48a64-5bbb-4a4f-bed1-0a24d39f061b"
    );
    expect(sanitizePathSegment("telegram:12345")).toBe("telegram_12345");
    const segment = sanitizePathSegment(userId);
    expect(segment).not.toMatch(/[:<>"/\\|?*]/);
    expect(getMemoriesDir(userId)).toContain(segment);
  });

  it("creates memory directories for web-scoped user ids", () => {
    const home = mkdtempSync(join(tmpdir(), "magicclaw-memories-"));
    process.env.MAGICCLAW_HOME = home;
    const memDir = getMemoriesDir("web:test-user");
    mkdirSync(memDir, { recursive: true });
    rmSync(home, { recursive: true, force: true });
  });
});
