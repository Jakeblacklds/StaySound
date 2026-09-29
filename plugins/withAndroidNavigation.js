const { withMainActivity, withAndroidManifest } = require('expo/config-plugins');

const marker = '// StaySound native Back: bypass the React Native JS BackHandler.';
const backOverride = `  ${marker}
  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R &&
        !onBackPressedDispatcher.hasEnabledCallbacks() && moveTaskToBack(false)) return
    super.invokeDefaultOnBackPressed()
  }
`;

function configureActivity(contents) {
  let result = contents.replace('super.onCreate(null)', 'super.onCreate(savedInstanceState)');
  if (!result.includes('super.onCreate(savedInstanceState)')) {
    throw new Error('StaySound navigation requires MainActivity.onCreate(savedInstanceState).');
  }
  if (!result.includes(marker)) {
    const declaration = 'class MainActivity : ReactActivity() {';
    if (!result.includes(declaration)) throw new Error('StaySound navigation requires a Kotlin ReactActivity MainActivity.');
    result = result.replace(declaration, `${declaration}\n${backOverride}`);
  }
  return result;
}
function configureManifest(manifest) {
  manifest.manifest.application[0].$['android:enableOnBackInvokedCallback'] = 'true';
  return manifest;
}

/** Android keeps its saved-state registry and sends Back directly to the native dispatcher. */
module.exports = function withAndroidNavigation(config) {
  config = withMainActivity(config, config => {
    config.modResults.contents = configureActivity(config.modResults.contents);
    return config;
  });
  return withAndroidManifest(config, config => {
    config.modResults = configureManifest(config.modResults);
    return config;
  });
};
module.exports.configureActivity = configureActivity;
module.exports.configureManifest = configureManifest;
