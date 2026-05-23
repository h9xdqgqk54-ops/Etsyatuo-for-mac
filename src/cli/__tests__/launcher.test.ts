import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySidecarNodeModuleResolution,
  buildSidecarNodeModulesPath,
  buildBrowserOpenCommand,
  buildPortableEnvironment,
  parseLauncherArgs,
} from "../launcher.js";

describe("CLI launcher", () => {
  it("parses host, port and no-open options", () => {
    const parsed = parseLauncherArgs(["--host", "0.0.0.0", "--port", "4567", "--no-open"]);

    expect(parsed).toEqual({
      host: "0.0.0.0",
      openBrowser: false,
      port: 4567,
      showHelp: false,
    });
  });

  it("parses help and keeps default browser opening enabled", () => {
    const parsed = parseLauncherArgs(["--help"]);

    expect(parsed.showHelp).toBe(true);
    expect(parsed.openBrowser).toBe(true);
    expect(parsed.host).toBe("127.0.0.1");
    expect(parsed.port).toBe(3456);
  });

  it("builds Windows portable data paths under APPDATA without overwriting explicit env values", () => {
    const env = buildPortableEnvironment({
      env: {
        APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
        ETSY_AGENT_DATA_PATH: "D:\\custom-data",
      },
      platform: "win32",
    });

    expect(env.ETSY_AGENT_DATA_PATH).toBe("D:\\custom-data");
    expect(env.ETSY_AGENT_STORAGE_PATH).toBe(path.win32.join("C:\\Users\\demo\\AppData\\Roaming", "Etsyauto", "storage"));
    expect(env.ETSY_AGENT_DESKTOP_ROOT).toBe(path.win32.join("C:\\Users\\demo", "Desktop"));
  });

  it("builds macOS portable data paths under Application Support", () => {
    const env = buildPortableEnvironment({
      env: { HOME: "/Users/demo" },
      platform: "darwin",
    });

    expect(env.ETSY_AGENT_DATA_PATH).toBe("/Users/demo/Library/Application Support/Etsyauto/data");
    expect(env.ETSY_AGENT_STORAGE_PATH).toBe("/Users/demo/Library/Application Support/Etsyauto/storage");
    expect(env.ETSY_AGENT_DESKTOP_ROOT).toBe("/Users/demo/Desktop");
    expect(env.ETSY_AGENT_PROMPT_RECORDS_PATH).toBe("/Users/demo/Library/Application Support/Etsyauto/data/prompt-records.json");
    expect(env.ETSY_AGENT_FOLDER_SETTINGS_PATH).toBe("/Users/demo/Library/Application Support/Etsyauto/data/folder-settings.json");
  });

  it("selects the browser open command for each platform", () => {
    expect(buildBrowserOpenCommand("http://127.0.0.1:3456/etsy-image-agent", "win32")).toEqual({
      args: ["/c", "start", "", "http://127.0.0.1:3456/etsy-image-agent"],
      command: "cmd",
    });
    expect(buildBrowserOpenCommand("http://127.0.0.1:3456/etsy-image-agent", "darwin")).toEqual({
      args: ["http://127.0.0.1:3456/etsy-image-agent"],
      command: "open",
    });
    expect(buildBrowserOpenCommand("http://127.0.0.1:3456/etsy-image-agent", "linux")).toEqual({
      args: ["http://127.0.0.1:3456/etsy-image-agent"],
      command: "xdg-open",
    });
  });

  it("adds the exe sidecar node_modules directory to module resolution when packaged", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "etsyauto-launcher-"));
    const sidecarNodeModules = path.join(tempDir, "node_modules");
    fs.mkdirSync(sidecarNodeModules);

    const env: NodeJS.ProcessEnv = { NODE_PATH: "C:\\existing\\node_modules" };
    const globalPaths: string[] = [];
    let initPathsCalled = false;

    const applied = applySidecarNodeModuleResolution({
      env,
      execPath: path.join(tempDir, "Etsyauto.exe"),
      isPkg: true,
      moduleGlobalPaths: globalPaths,
      platform: "win32",
      initPaths: () => {
        initPathsCalled = true;
      },
    });

    expect(buildSidecarNodeModulesPath(path.join(tempDir, "Etsyauto.exe"))).toBe(sidecarNodeModules);
    expect(applied).toBe(sidecarNodeModules);
    expect(env.NODE_PATH?.split(";")[0]).toBe(sidecarNodeModules);
    expect(globalPaths[0]).toBe(sidecarNodeModules);
    expect(initPathsCalled).toBe(true);
  });
});
