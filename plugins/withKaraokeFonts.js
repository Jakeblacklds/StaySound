const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FONT_FILES = [
  ['apple', 'SFPRODISPLAYREGULAR.ttf'],
  ['apple', 'SFPRODISPLAYMEDIUM.ttf'],
  ['apple', 'SFPRODISPLAYBOLD.ttf'],
  ['apple', 'SFPRODISPLAYSEMIBOLDITALIC.ttf'],
  ['newsreader', 'Newsreader-Variable.ttf'],
  ['newsreader', 'Newsreader16pt-Bold.ttf'],
  ['inter', 'Inter-Variable.ttf'],
  ['syne', 'Syne-Variable.ttf'],
  ['spacegrotesk', 'SpaceGrotesk-Variable.ttf'],
  ['fraunces', 'Fraunces-Variable.ttf'],
  ['nunito', 'Nunito-Variable.ttf'],
];

function withKaraokeFonts(config) {
  return withDangerousMod(config, [
    'android',
    async config => {
      const projectRoot = config.modRequest.projectRoot;
      const targetDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'fonts');

      fs.mkdirSync(targetDir, { recursive: true });

      for (const [familyDir, fontFile] of FONT_FILES) {
        fs.copyFileSync(
          path.join(projectRoot, 'assets', 'fonts', familyDir, fontFile),
          path.join(targetDir, fontFile),
        );
      }

      return config;
    },
  ]);
}

module.exports = withKaraokeFonts;
