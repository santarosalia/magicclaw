import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandUserPath, getMagicClawHome } from "./magicclaw-home.js";

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
});
