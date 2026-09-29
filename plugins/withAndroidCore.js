const { withSettingsGradle } = require('expo/config-plugins');

const declaration = "includeBuild('../android-core')";
function configureSettings(contents) {
  return contents.includes(declaration) ? contents : `${contents}\n// StaySound core is an independent Kotlin build without React Native dependencies.\n${declaration}\n`;
}
module.exports = config => withSettingsGradle(config, config => {
  if (config.modResults.language !== 'groovy') throw new Error('StaySound core expects Groovy settings.gradle');
  config.modResults.contents = configureSettings(config.modResults.contents);
  return config;
});
module.exports.configureSettings = configureSettings;
