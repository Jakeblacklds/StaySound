const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FONT_FILES = [
  'SFPRODISPLAYREGULAR.ttf',
  'SFPRODISPLAYMEDIUM.ttf',
  'SFPRODISPLAYBOLD.ttf',
  'SFPRODISPLAYSEMIBOLDITALIC.ttf',
];

function withKaraokeFonts(config) {
  return withDangerousMod(config, [
    'android',
    async config => {
      const projectRoot = config.modRequest.projectRoot;
      const sourceDir = path.join(projectRoot, 'assets', 'fonts', 'apple');
      const targetDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'fonts');

      fs.mkdirSync(targetDir, { recursive: true });

      for (const fontFile of FONT_FILES) {
        fs.copyFileSync(path.join(sourceDir, fontFile), path.join(targetDir, fontFile));
      }

      return config;
    },
  ]);
}

module.exports = withKaraokeFonts;
