const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = {
    expo: {
        name: IS_DEV ? "StaySound dev" : "StaySound",
        slug: "StaySound",
        version: "1.0.0",
        orientation: "portrait",
        icon: "./assets/images/appicon.png",
        scheme: "staysound",
        userInterfaceStyle: "automatic",
        newArchEnabled: true,
        splash: {
            image: "./assets/images/splash-icon.png",
            resizeMode: "contain",
            backgroundColor: "#0a0a0a"
        },
        ios: {
            supportsTablet: true,
            bundleIdentifier: IS_DEV ? "com.staysound.app.dev" : "com.staysound.app.pro",
            infoPlist: {
                UIBackgroundModes: ["audio"],
                NSAppleMusicUsageDescription: "StaySound needs access to your music library",
                NSPhotoLibraryUsageDescription: "StaySound needs access to display album artwork"
            }
        },
        android: {
            adaptiveIcon: {
                foregroundImage: "./assets/images/appicon.png",
                backgroundColor: "#0a0a0a"
            },
            edgeToEdgeEnabled: true,
            package: IS_DEV ? "com.staysound.app.dev" : "com.staysound.app.pro",
            versionCode: 1,
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            permissions: [
                "READ_EXTERNAL_STORAGE",
                "READ_MEDIA_AUDIO",
                "FOREGROUND_SERVICE",
                "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
                "WAKE_LOCK",
                "MODIFY_AUDIO_SETTINGS",
                "ACCESS_MEDIA_LOCATION",
                "android.permission.RECORD_AUDIO",
                "android.permission.MODIFY_AUDIO_SETTINGS",
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE",
                "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
                "android.permission.ACCESS_MEDIA_LOCATION",
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_MEDIA_VIDEO",
                "android.permission.READ_MEDIA_AUDIO"
            ]
        },
        web: {
            bundler: "metro",
            output: "static",
            favicon: "./assets/images/favicon.png"
        },
        plugins: [
            "expo-router",
            "expo-system-ui",
            [
                "expo-audio",
                {
                    "microphonePermission": false
                }
            ],
            "expo-sqlite",
            [
                "expo-media-library",
                {
                    "photosPermission": "Allow StaySound to access album artwork",
                    "savePhotosPermission": false,
                    "isAccessMediaLocationEnabled": true
                }
            ],
            "expo-asset"
        ],
        experiments: {
            typedRoutes: true
        },
        extra: {
            router: {},
            eas: {
                projectId: "f9cff190-672e-4832-add3-4a9cb3e68343"
            }
        }
    }
};
