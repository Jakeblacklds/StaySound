const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_NAME = 'StaySoundAndroidAutoCatalogModule.kt';
const PACKAGE_NAME = 'StaySoundAndroidAutoCatalogPackage.kt';
const ANDROID_AUTO_METADATA_NAME = 'com.google.android.gms.car.application';
const ANDROID_AUTO_DESCRIPTOR = '@xml/automotive_app_desc';
const ATTRIBUTION_ICON_METADATA_NAME = 'androidx.car.app.TintableAttributionIcon';
const ATTRIBUTION_ICON_RESOURCE = '@drawable/ic_staysound_car_attribution';
const AUTOMOTIVE_DESCRIPTOR_SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`;
const ATTRIBUTION_ICON_SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="24"
  android:viewportHeight="24">
  <path
    android:fillColor="#FFFFFFFF"
    android:pathData="M12,3v10.55A4,4 0,1 0,14 17V7h4V3h-6z" />
</vector>
`;

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
  config = withAndroidManifest(config, config => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults
    );
    const metadata = mainApplication['meta-data'] || [];
    const existingEntry = metadata.find(
      entry => entry.$?.['android:name'] === ANDROID_AUTO_METADATA_NAME
    );
    const existingAttributionIcon = metadata.find(
      entry => entry.$?.['android:name'] === ATTRIBUTION_ICON_METADATA_NAME
    );

    if (existingEntry) {
      existingEntry.$['android:resource'] = ANDROID_AUTO_DESCRIPTOR;
      delete existingEntry.$['android:value'];
    } else {
      metadata.push({
        $: {
          'android:name': ANDROID_AUTO_METADATA_NAME,
          'android:resource': ANDROID_AUTO_DESCRIPTOR,
        },
      });
    }

    if (existingAttributionIcon) {
      existingAttributionIcon.$['android:resource'] = ATTRIBUTION_ICON_RESOURCE;
      delete existingAttributionIcon.$['android:value'];
    } else {
      metadata.push({
        $: {
          'android:name': ATTRIBUTION_ICON_METADATA_NAME,
          'android:resource': ATTRIBUTION_ICON_RESOURCE,
        },
      });
    }

    mainApplication['meta-data'] = metadata;
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async config => {
      const packageName = getPackageName(config);
      const packageDir = getPackageDir(config.modRequest.projectRoot, packageName);
      const xmlDir = path.join(
        config.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      const drawableDir = path.join(
        config.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
        'drawable'
      );

      fs.mkdirSync(packageDir, { recursive: true });
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, MODULE_NAME), buildModuleSource(packageName));
      fs.writeFileSync(path.join(packageDir, PACKAGE_NAME), buildPackageSource(packageName));
      fs.writeFileSync(
        path.join(xmlDir, 'automotive_app_desc.xml'),
        AUTOMOTIVE_DESCRIPTOR_SOURCE
      );
      fs.writeFileSync(
        path.join(drawableDir, 'ic_staysound_car_attribution.xml'),
        ATTRIBUTION_ICON_SOURCE
      );

      return config;
    },
  ]);

  config = withMainApplication(config, config => {
    const registration = 'add(StaySoundAndroidAutoCatalogPackage())';
    if (config.modResults.contents.includes(registration)) {
      return config;
    }

    const packagesApplyPattern = /(PackageList\(this\)\.packages\.apply\s*\{\s*\n)/;
    if (!packagesApplyPattern.test(config.modResults.contents)) {
      throw new Error(
        'Could not register StaySoundAndroidAutoCatalogPackage in MainApplication.kt'
      );
    }

    config.modResults.contents = config.modResults.contents.replace(
      packagesApplyPattern,
      `$1              ${registration}\n`
    );

    return config;
  });

  return config;
}

module.exports = withAndroidAutoCatalogModule;
