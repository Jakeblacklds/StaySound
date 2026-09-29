const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureActivity, configureManifest } = require('../../plugins/withAndroidNavigation');

test('prebuild preserves saved state, bypasses JS Back and remains idempotent', () => {
  const activity = `import android.os.Build
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(null) }
  override fun getMainComponentName(): String = "main"
}`;
  const output = configureActivity(activity);
  assert.match(output, /super\.onCreate\(savedInstanceState\)/);
  assert.match(output, /override fun onBackPressed\(\)/);
  assert.match(output, /super\.invokeDefaultOnBackPressed\(\)/);
  assert.match(output, /moveTaskToBack\(false\)/);
  assert.match(output, /getMainComponentName\(\): String = "main"/);
  assert.equal(configureActivity(output), output);
});

test('manifest mod enables predictive Back and preserves existing links', () => {
  const manifest = { manifest: { application: [{ $: { 'android:enableOnBackInvokedCallback': 'false' },
    activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ data: [{ $: { 'android:scheme': 'staysound' } }] }] }] }] } };
  const before = JSON.stringify(manifest.manifest.application[0].activity);
  const output = configureManifest(manifest);
  assert.equal(output.manifest.application[0].$['android:enableOnBackInvokedCallback'], 'true');
  assert.equal(JSON.stringify(output.manifest.application[0].activity), before);
  assert.deepEqual(configureManifest(output), output);
});

test('unexpected templates fail explicitly instead of silently losing restoration', () => {
  assert.throws(() => configureActivity('class CustomActivity {}'), /requires MainActivity/);
});
