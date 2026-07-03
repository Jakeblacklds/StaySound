import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const PROD_APK_PATH = path.resolve(ROOT, "android/app/build/outputs/apk/prod/release/app-prod-release.apk");
const DIST_APK_PATH = path.resolve(ROOT, "out/android/app-prod-release.apk");
const GRADLE_APK_PATH = path.resolve(ROOT, "android/app/build/outputs/apk/release/app-release.apk");

function loadDotEnv() {
  const envPath = path.resolve(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const result = {
    skipBuild: false,
    mandatory: false,
    notes: "",
    channel: "prod",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--skip-build") {
      result.skipBuild = true;
      continue;
    }
    if (current === "--mandatory") {
      result.mandatory = true;
      continue;
    }
    if (current === "--notes") {
      result.notes = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (current === "--channel") {
      result.channel = (argv[index + 1] ?? "prod").trim() || "prod";
      index += 1;
    }
  }

  return result;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function computeFileSha256(filePath) {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function getSupabaseConfig() {
  const url =
    process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.MIRROR_SUPABASE_SERVICE_ROLE_KEY ||
    "";
  const bucket = (process.env.APP_RELEASES_STORAGE_BUCKET || "staysound-releases").trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase release credentials. Set EXPO_PUBLIC_AUTH_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return { url, serviceRoleKey, bucket };
}

function getReleaseConfig() {
  process.env.APP_VARIANT = "production";
  const configPath = path.resolve(ROOT, "app.config.js");
  delete require.cache[require.resolve(configPath)];
  const configModule = require(configPath);
  const expoConfig = configModule.expo ?? configModule;
  const appUpdates = expoConfig.extra?.appUpdates ?? {};

  return {
    versionName: expoConfig.version,
    versionCode: expoConfig.android?.versionCode,
    runtimeVersion: expoConfig.runtimeVersion,
    packageName: expoConfig.android?.package,
    binaryChannel: appUpdates.binaryChannel || "prod",
  };
}

async function uploadFile({ url, serviceRoleKey, bucket, filePath, objectPath }) {
  const body = fs.readFileSync(filePath);
  const filename = path.basename(objectPath);
  const response = await fetch(
    `${url}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-upsert": "true",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": APK_MIME_TYPE,
        "x-content-type-options": "nosniff",
      },
      body,
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Storage upload failed (${response.status}): ${text}`);
  }
}

function getReleaseApkPath() {
  const candidates = [PROD_APK_PATH, DIST_APK_PATH, GRADLE_APK_PATH];
  const apkPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (apkPath) return apkPath;

  throw new Error(
    `Release APK not found. Checked: ${candidates.join(", ")}.`,
  );
}

async function upsertReleaseRow({ url, serviceRoleKey, row }) {
  const response = await fetch(
    `${url}/rest/v1/app_binary_releases?on_conflict=platform,channel`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([row]),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Release metadata upsert failed (${response.status}): ${text}`);
  }
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipBuild) {
    runCommand("npm", ["run", "android:build:release"]);
  }

  const { url, serviceRoleKey, bucket } = getSupabaseConfig();
  const releaseConfig = getReleaseConfig();
  const apkPath = getReleaseApkPath();
  const sha256 = await computeFileSha256(apkPath);
  const objectPath = `android/${args.channel}/staysound-${releaseConfig.versionName}-${releaseConfig.versionCode}.apk`;

  await uploadFile({
    url,
    serviceRoleKey,
    bucket,
    filePath: apkPath,
    objectPath,
  });

  await upsertReleaseRow({
    url,
    serviceRoleKey,
    row: {
      platform: "android",
      channel: args.channel || releaseConfig.binaryChannel,
      version_code: releaseConfig.versionCode,
      version_name: releaseConfig.versionName,
      runtime_version: releaseConfig.runtimeVersion,
      package_name: releaseConfig.packageName,
      storage_bucket: bucket,
      storage_path: objectPath,
      sha256,
      mandatory: args.mandatory,
      notes: args.notes,
      published_at: new Date().toISOString(),
    },
  });

  console.log("# Android release published");
  console.log(`- APK: ${apkPath}`);
  console.log(`- Channel: ${args.channel || releaseConfig.binaryChannel}`);
  console.log(`- Version: ${releaseConfig.versionName} (${releaseConfig.versionCode})`);
  console.log(`- Runtime: ${releaseConfig.runtimeVersion}`);
  console.log(`- SHA-256: ${sha256}`);
  console.log(`- Storage: ${bucket}/${objectPath}`);
}

await main();
