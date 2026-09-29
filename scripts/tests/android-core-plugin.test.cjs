const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureSettings } = require('../../plugins/withAndroidCore');
test('native core survives Expo prebuild without duplicate composite builds', () => {
  const existing = "include ':app'\n";
  const configured = configureSettings(existing);
  assert.ok(configured.startsWith(existing));
  assert.equal(configureSettings(configured), configured);
  assert.equal(configured.match(/includeBuild\('\.\.\/android-core'\)/g).length, 1);
});
