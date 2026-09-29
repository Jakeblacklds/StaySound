const { withSettingsGradle, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const declaration = "includeBuild('../android-core')";
function configureSettings(contents) {
  return contents.includes(declaration) ? contents : `${contents}\n// StaySound core is an independent Kotlin build without React Native dependencies.\n${declaration}\n`;
}
const NATIVE_DATA_KEY = 'app.staysound.NATIVE_DATA';
/** Opt-in per build (STAYSOUND_NATIVE_DATA=1): Room/DataStore own user data instead of the legacy JSON files. */
function configureNativeData(manifest, enabled) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const data = (application['meta-data'] ??= []).filter(item => item.$['android:name'] !== NATIVE_DATA_KEY);
  if (enabled) data.push({ $: { 'android:name': NATIVE_DATA_KEY, 'android:value': 'true' } });
  application['meta-data'] = data;
  return manifest;
}
module.exports = config => {
  config = withSettingsGradle(config, config => {
    if (config.modResults.language !== 'groovy') throw new Error('StaySound core expects Groovy settings.gradle');
    config.modResults.contents = configureSettings(config.modResults.contents);
    return config;
  });
  return withAndroidManifest(config, config => {
    config.modResults = configureNativeData(config.modResults, process.env.STAYSOUND_NATIVE_DATA === '1');
    return config;
  });
};
module.exports.configureSettings = configureSettings;
module.exports.configureNativeData = configureNativeData;
