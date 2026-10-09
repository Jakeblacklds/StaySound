const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureSettings, configureNativeData } = require('../../plugins/withAndroidCore');
test('native core survives Expo prebuild without duplicate composite builds', () => {
  const existing = "include ':app'\n";
  const configured = configureSettings(existing);
  assert.ok(configured.startsWith(existing));
  assert.equal(configureSettings(configured), configured);
  assert.equal(configured.match(/includeBuild\('\.\.\/android-core'\)/g).length, 1);
});

test('native data is an explicit per-build opt-in and prebuild stays idempotent', () => {
  const manifest = () => ({ manifest: { application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [{ $: { 'android:name': 'other', 'android:value': '1' } }] }] } });
  const flag = value => value.manifest.application[0]['meta-data'].filter(item => item.$['android:name'] === 'app.staysound.NATIVE_DATA');
  assert.equal(flag(configureNativeData(manifest(), false)).length, 0);
  const enabled = configureNativeData(configureNativeData(manifest(), true), true);
  assert.equal(flag(enabled).length, 1);
  assert.equal(flag(enabled)[0].$['android:value'], 'true');
  assert.equal(enabled.manifest.application[0]['meta-data'].some(item => item.$['android:name'] === 'other'), true);
  assert.equal(flag(configureNativeData(enabled, false)).length, 0);
});
