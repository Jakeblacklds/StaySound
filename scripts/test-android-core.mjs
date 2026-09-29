import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME || path.join(process.env.HOME, '.jdks/jdk-17.0.19+10/Contents/Home');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.HOME, 'Library/Android/sdk');
const wrapper = path.join(root, 'android-core', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (!fs.existsSync(wrapper)) throw new Error('The android-core Gradle 8.14.3 wrapper is missing.');
// The Kotlin ScanReconciler is checked against fixtures generated from the TypeScript; fail early if they drifted.
const golden = spawnSync(process.execPath, [path.join(root, 'scripts/generate-scan-golden.mjs'), '--check'], { cwd: root, stdio: 'inherit' });
if (golden.status !== 0) { process.exitCode = golden.status ?? 1; process.exit(); }
const result = spawnSync(wrapper, ['-p', path.join(root, 'android-core'), ':model:test', ':data:testDebugUnitTest', ':data:verifyNoReactRuntime', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
});
process.exitCode = result.status ?? 1;
