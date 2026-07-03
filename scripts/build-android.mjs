import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function parseArgs(argv) {
  const args = {
    arch: "",
    task: "app:assembleProdRelease",
    variant: "production",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--arch") {
      args.arch = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (current === "--task") {
      args.task = argv[index + 1] ?? args.task;
      index += 1;
      continue;
    }
    if (current === "--variant") {
      args.variant = argv[index + 1] ?? args.variant;
      index += 1;
    }
  }

  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function findNewestApk() {
  const outputsDir = path.join(ROOT, "android", "app", "build", "outputs", "apk");
  if (!fs.existsSync(outputsDir)) return null;

  const stack = [outputsDir];
  const apks = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".apk")) {
        apks.push(fullPath);
      }
    }
  }

  return apks
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
}

function copyReleaseArtifact() {
  if (!args.task.toLowerCase().includes("assemble")) return;

  const newestApk = findNewestApk();
  if (!newestApk) return;

  const outputDir = path.join(ROOT, "out", "android");
  fs.mkdirSync(outputDir, { recursive: true });
  const targetName =
    args.variant === "development" || args.task.toLowerCase().includes("debug")
      ? "app-dev-debug.apk"
      : "app-prod-release.apk";
  const targetPath = path.join(outputDir, targetName);
  fs.copyFileSync(newestApk, targetPath);
  console.log(`APK copied to ${path.relative(ROOT, targetPath)}`);
}

function ensureAndroidProject(env) {
  const gradlew = path.join(ROOT, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (fs.existsSync(gradlew)) return;

  console.log("android/ not found. Running Expo prebuild for Android...");
  run("npx", ["expo", "prebuild", "--platform", "android"], { env });
}

function ensureGradleExecutable() {
  if (process.platform === "win32") return;

  const gradlew = path.join(ROOT, "android", "gradlew");
  if (fs.existsSync(gradlew)) {
    fs.chmodSync(gradlew, 0o755);
  }
}

const args = parseArgs(process.argv.slice(2));
const defaultJavaHome = path.join(process.env.HOME ?? "", ".jdks", "jdk-17.0.19+10", "Contents", "Home");
const defaultAndroidHome = path.join(process.env.HOME ?? "", "Library", "Android", "sdk");
const javaHome = process.env.JAVA_HOME || (fs.existsSync(defaultJavaHome) ? defaultJavaHome : "");
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultAndroidHome;
const pathParts = [
  javaHome ? path.join(javaHome, "bin") : "",
  path.join(androidHome, "cmdline-tools", "latest", "bin"),
  path.join(androidHome, "platform-tools"),
  process.env.PATH ?? "",
].filter(Boolean);
const env = {
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  PATH: pathParts.join(path.delimiter),
  APP_VARIANT: args.variant,
};

if (args.arch) {
  env.ORG_GRADLE_PROJECT_reactNativeArchitectures = args.arch;
}

ensureAndroidProject(env);
ensureGradleExecutable();

const gradlewPath = path.join("android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
run(gradlewPath, ["-p", "android", args.task], { env });
copyReleaseArtifact();
