import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const installerPath =
  process.env.AMS_TAURI_NSIS_INSTALLER ||
  path.join(
    repoRoot,
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle",
    "nsis",
    "Album Mastering Studio_0.1.0_x64-setup.exe",
  );
const outputRoot =
  process.env.AMS_TAURI_NSIS_OUTPUT || path.join(repoRoot, "test-output", "tauri-nsis-install-smoke");
const defaultInstallDir = path.join(process.env.LOCALAPPDATA || "", "Album Mastering Studio");
const installDir =
  process.env.AMS_TAURI_NSIS_INSTALL_DIR || defaultInstallDir;
const installedExe = path.join(installDir, "album-mastering-studio.exe");
const uninstallerPath = path.join(installDir, "uninstall.exe");
const releaseSmokeOutput = path.join(outputRoot, "release-launch");
const uninstallKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Album Mastering Studio";
const manufacturerKey = "HKCU\\Software\\Album Mastering Studio";

assert.equal(existsSync(installerPath), true, `NSIS installer not found: ${installerPath}`);
mkdirSync(outputRoot, { recursive: true });

const before = {
  installDirExists: existsSync(installDir),
  manufacturerRegistry: regQuery(manufacturerKey),
  uninstallRegistry: regQuery(uninstallKey),
};
assert.equal(before.uninstallRegistry.exists, false, `Existing install registry key would be overwritten: ${uninstallKey}`);
assert.equal(
  before.manufacturerRegistry.exists,
  false,
  `Existing manufacturer registry key would be overwritten: ${manufacturerKey}`,
);
assert.equal(before.installDirExists, false, `Existing install directory would be overwritten: ${installDir}`);

const installArgs = process.env.AMS_TAURI_NSIS_INSTALL_DIR
  ? ["/S", "/NS", `/D=${installDir}`]
  : ["/S", "/NS"];
const install = runProcess(installerPath, installArgs, 360_000);
assert.equal(install.status, 0, install.stderr || install.stdout);
waitFor(() => existsSync(installedExe), 10_000, `installed EXE to appear at ${installedExe}`);
assert.equal(existsSync(installedExe), true, `Installed EXE missing: ${installedExe}`);
assert.equal(existsSync(path.join(installDir, "resources", "engine", "album-master-engine.exe")), true);
assert.equal(existsSync(path.join(installDir, "resources", "ffmpeg", "ffmpeg.exe")), true);
assert.equal(existsSync(path.join(installDir, "resources", "ffmpeg", "ffprobe.exe")), true);

const installedRegistry = regQuery(uninstallKey);
assert.equal(installedRegistry.exists, true, "Installer did not create the uninstall registry key");
assert.match(installedRegistry.output, /DisplayName\s+REG_SZ\s+Album Mastering Studio/);
assert.match(installedRegistry.output, /DisplayVersion\s+REG_SZ\s+0\.1\.0/);

const launchSmoke = runProcess("node", [path.join("tests", "tauri-release-launch-smoke.mjs")], 240_000, {
  AMS_TAURI_RELEASE_EXE: installedExe,
  AMS_TAURI_RELEASE_OUTPUT: releaseSmokeOutput,
  TAURI_CDP_PORT: "9342",
});
assert.equal(launchSmoke.status, 0, launchSmoke.stderr || launchSmoke.stdout);

const uninstall = runProcess(uninstallerPath, ["/S"], 240_000);
assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
waitFor(() => !existsSync(installedExe), 10_000, `installed EXE to be removed from ${installedExe}`);
waitFor(() => !regQuery(uninstallKey).exists, 10_000, `uninstall registry key to be removed: ${uninstallKey}`);
safeRemoveInstallRoot();
safeRemoveManufacturerKey();

const after = {
  installDirExists: existsSync(installDir),
  installedExeExists: existsSync(installedExe),
  manufacturerRegistry: regQuery(manufacturerKey),
  uninstallRegistry: regQuery(uninstallKey),
};
assert.equal(after.installedExeExists, false, "Uninstall left the installed EXE behind");
assert.equal(after.uninstallRegistry.exists, false, "Uninstall left the uninstall registry key behind");

const evidence = {
  after,
  before,
  installDir,
  installedExe,
  installerPath,
  installExitCode: install.status,
  launchSmokeExitCode: launchSmoke.status,
  releaseSmokeOutput,
  uninstallExitCode: uninstall.status,
};
const resultPath = path.join(outputRoot, "tauri-nsis-install-smoke.json");
writeFileSync(resultPath, JSON.stringify(evidence, null, 2));

console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));

function runProcess(command, args, timeout, extraEnv = {}) {
  return spawnSync(command, args, {
    cwd: path.join(repoRoot, "desktop"),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout,
    windowsHide: true,
  });
}

function regQuery(key) {
  const result = spawnSync("reg", ["query", key], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    exists: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    status: result.status,
  };
}

function regDelete(key) {
  return spawnSync("reg", ["delete", key, "/f"], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function safeRemoveInstallRoot() {
  const target = path.resolve(installDir);
  const allowedRoot = path.resolve(outputRoot);
  const allowedDefaultInstall =
    target.toLowerCase() === path.resolve(defaultInstallDir).toLowerCase() && before.installDirExists === false;
  assert.equal(
    target.startsWith(allowedRoot) || allowedDefaultInstall,
    true,
    `Refusing to remove install dir outside owned smoke targets: ${target}`,
  );
  rmSync(target, { force: true, recursive: true });
}

function safeRemoveManufacturerKey() {
  const manufacturerRegistry = regQuery(manufacturerKey);
  if (!manufacturerRegistry.exists) return;
  if (!manufacturerRegistry.output.includes(installDir)) return;
  regDelete(manufacturerKey);
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    sleepSync(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
