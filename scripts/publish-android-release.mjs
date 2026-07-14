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

async function ensurePublicBucket({ url, serviceRoleKey, bucket }) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const lookup = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });

  if (lookup.ok) {
    const info = await lookup.json();
    if (info.public) return;

    const update = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ public: true }),
    });
    if (!update.ok) {
      const text = await update.text().catch(() => "");
      throw new Error(`Could not make bucket "${bucket}" public (${update.status}): ${text}`);
    }
    console.log(`Bucket "${bucket}" switched to public.`);
    return;
  }

  if (lookup.status !== 404 && lookup.status !== 400) {
    const text = await lookup.text().catch(() => "");
    throw new Error(`Bucket lookup failed (${lookup.status}): ${text}`);
  }

  const create = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  });
  if (!create.ok) {
    const text = await create.text().catch(() => "");
    throw new Error(`Bucket creation failed (${create.status}): ${text}`);
  }
  console.log(`Bucket "${bucket}" created (public).`);
}

async function uploadObject({ url, serviceRoleKey, bucket, body, objectPath, contentType }) {
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
        "Content-Type": contentType,
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

function getPublicObjectUrl({ url, bucket, objectPath }) {
  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function fetchExistingManifest({ url, bucket, channel }) {
  const manifestUrl = getPublicObjectUrl({ url, bucket, objectPath: `android/${channel}/manifest.json` });
  try {
    const response = await fetch(`${manifestUrl}?t=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function findAapt2() {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.HOME || "", "Library/Android/sdk"),
    path.join(process.env.HOME || "", "Android/Sdk"),
  ].filter(Boolean);

  for (const sdkRoot of sdkRoots) {
    const buildToolsDir = path.join(sdkRoot, "build-tools");
    if (!fs.existsSync(buildToolsDir)) continue;
    const versions = fs.readdirSync(buildToolsDir).sort().reverse();
    for (const version of versions) {
      const binary = path.join(buildToolsDir, version, process.platform === "win32" ? "aapt2.exe" : "aapt2");
      if (fs.existsSync(binary)) return binary;
    }
  }
  return null;
}

function verifyApkMatchesRelease(apkPath, releaseConfig) {
  const aapt2 = findAapt2();
  if (!aapt2) {
    console.warn("Warning: aapt2 not found; skipping APK version verification.");
    return;
  }

  const result = spawnSync(aapt2, ["dump", "badging", apkPath], { encoding: "utf8" });
  if (result.status !== 0) {
    console.warn("Warning: aapt2 failed; skipping APK version verification.");
    return;
  }

  const header = result.stdout.split(/\r?\n/, 1)[0] ?? "";
  const packageName = header.match(/name='([^']+)'/)?.[1];
  const versionCode = Number(header.match(/versionCode='([^']+)'/)?.[1]);
  const versionName = header.match(/versionName='([^']+)'/)?.[1];

  const problems = [];
  if (packageName !== releaseConfig.packageName) {
    problems.push(`package ${packageName} != ${releaseConfig.packageName}`);
  }
  if (versionCode !== releaseConfig.versionCode) {
    problems.push(`versionCode ${versionCode} != ${releaseConfig.versionCode}`);
  }
  if (versionName !== releaseConfig.versionName) {
    problems.push(`versionName ${versionName} != ${releaseConfig.versionName}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `APK does not match app.config.js (${problems.join("; ")}). ` +
        "Rebuild with `npm run android:build:release` so the manifest and APK stay in sync.",
    );
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
  verifyApkMatchesRelease(apkPath, releaseConfig);
  const sha256 = await computeFileSha256(apkPath);
  const channel = args.channel || releaseConfig.binaryChannel;
  const objectPath = `android/${channel}/staysound-${releaseConfig.versionName}-${releaseConfig.versionCode}.apk`;
  const manifestPath = `android/${channel}/manifest.json`;

  await ensurePublicBucket({ url, serviceRoleKey, bucket });

  const existingManifest = await fetchExistingManifest({ url, bucket, channel });
  if (existingManifest && Number(existingManifest.versionCode) > releaseConfig.versionCode) {
    throw new Error(
      `Remote manifest already has versionCode ${existingManifest.versionCode} (local is ${releaseConfig.versionCode}). ` +
        "Bump ANDROID_VERSION_CODE in app.config.js before publishing.",
    );
  }
  if (existingManifest && Number(existingManifest.versionCode) === releaseConfig.versionCode) {
    console.warn(
      `Warning: republishing versionCode ${releaseConfig.versionCode}. Installed apps on this version will not prompt; ` +
        "bump ANDROID_VERSION_CODE in app.config.js if this is a new release.",
    );
  }

  await uploadObject({
    url,
    serviceRoleKey,
    bucket,
    body: fs.readFileSync(apkPath),
    objectPath,
    contentType: APK_MIME_TYPE,
  });

  const manifest = {
    platform: "android",
    channel,
    versionCode: releaseConfig.versionCode,
    versionName: releaseConfig.versionName,
    runtimeVersion: releaseConfig.runtimeVersion,
    packageName: releaseConfig.packageName,
    apkUrl: getPublicObjectUrl({ url, bucket, objectPath }),
    sha256,
    mandatory: args.mandatory,
    notes: args.notes,
    publishedAt: new Date().toISOString(),
  };

  await uploadObject({
    url,
    serviceRoleKey,
    bucket,
    body: JSON.stringify(manifest, null, 2),
    objectPath: manifestPath,
    contentType: "application/json",
  });

  try {
    await upsertReleaseRow({
      url,
      serviceRoleKey,
      row: {
        platform: "android",
        channel,
        version_code: releaseConfig.versionCode,
        version_name: releaseConfig.versionName,
        runtime_version: releaseConfig.runtimeVersion,
        package_name: releaseConfig.packageName,
        storage_bucket: bucket,
        storage_path: objectPath,
        sha256,
        mandatory: args.mandatory,
        notes: args.notes,
        published_at: manifest.publishedAt,
      },
    });
  } catch (error) {
    console.warn(
      `Warning: release history row not saved (${error instanceof Error ? error.message : error}). ` +
        "Run supabase/migrations/20260422_app_binary_releases.sql in the Supabase SQL editor to enable history. " +
        "The update itself was published correctly via manifest.json.",
    );
  }

  console.log("# Android release published");
  console.log(`- APK: ${apkPath}`);
  console.log(`- Channel: ${channel}`);
  console.log(`- Version: ${releaseConfig.versionName} (${releaseConfig.versionCode})`);
  console.log(`- Runtime: ${releaseConfig.runtimeVersion}`);
  console.log(`- SHA-256: ${sha256}`);
  console.log(`- Storage: ${bucket}/${objectPath}`);
  console.log(`- Manifest: ${getPublicObjectUrl({ url, bucket, objectPath: manifestPath })}`);
  console.log(`- Download: ${manifest.apkUrl}`);
}

await main();
