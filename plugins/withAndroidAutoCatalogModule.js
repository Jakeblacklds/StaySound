const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_NAME = 'StaySoundAndroidAutoCatalogModule.kt';
const PACKAGE_NAME = 'StaySoundAndroidAutoCatalogPackage.kt';

function getPackageName(config) {
  return config.android?.package || 'com.staysound.app.pro';
}

function getPackageDir(projectRoot, packageName) {
  return path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packageName.split('.')
  );
}

function buildModuleSource(packageName) {
  return `package ${packageName}

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class StaySoundAndroidAutoCatalogModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "StaySoundAndroidAutoCatalog"

  @ReactMethod
  fun updateCatalog(catalogJson: String, promise: Promise) {
    try {
      reactApplicationContext
        .getSharedPreferences(AUTO_CATALOG_PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(AUTO_CATALOG_KEY, catalogJson)
        .apply()

      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("ANDROID_AUTO_CATALOG_WRITE_FAILED", error)
    }
  }

  companion object {
    private const val AUTO_CATALOG_PREFS_NAME = "staysound_android_auto"
    private const val AUTO_CATALOG_KEY = "catalog_json"
  }
}
`;
}

function buildPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class StaySoundAndroidAutoCatalogPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(StaySoundAndroidAutoCatalogModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`;
}

function withAndroidAutoCatalogModule(config) {
  config = withDangerousMod(config, [
    'android',
    async config => {
      const packageName = getPackageName(config);
      const packageDir = getPackageDir(config.modRequest.projectRoot, packageName);

      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, MODULE_NAME), buildModuleSource(packageName));
      fs.writeFileSync(path.join(packageDir, PACKAGE_NAME), buildPackageSource(packageName));

      return config;
    },
  ]);

  config = withMainApplication(config, config => {
    const registration = 'add(StaySoundAndroidAutoCatalogPackage())';
    if (config.modResults.contents.includes(registration)) {
      return config;
    }

    config.modResults.contents = config.modResults.contents.replace(
      /(\s*\/\/ add\(MyReactNativePackage\(\)\)\n)/,
      `$1              ${registration}\n`
    );

    return config;
  });

  return config;
}

module.exports = withAndroidAutoCatalogModule;
