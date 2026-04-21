const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = {
    expo: {
        name: IS_DEV ? "StaySound dev" : "StaySound",
        slug: "StaySound",
        version: "1.0.1",
        orientation: "portrait",
        icon: "./assets/images/appicon.png",
        scheme: "staysound",
        userInterfaceStyle: "automatic",
        newArchEnabled: true,
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
            versionCode: 2,
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            permissions: [
                "READ_EXTERNAL_STORAGE",
                "READ_MEDIA_AUDIO",
                "READ_MEDIA_IMAGES",
                "READ_MEDIA_VISUAL_USER_SELECTED",
                "FOREGROUND_SERVICE",
                "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
                "WAKE_LOCK",
                "MODIFY_AUDIO_SETTINGS"
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
                "expo-splash-screen",
                {
                    android: {
                        backgroundColor: "#080B12",
                        drawable: {
                            icon: "./assets/splashscreen-transparent.xml"
                        }
                    }
                }
            ],
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
                    "isAccessMediaLocationEnabled": false
                }
            ],
            "expo-asset"
        ],
        experiments: {
            typedRoutes: true
        },
        extra: {
            router: {},
            authSupabase: {
                url: process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL || '',
                anonKey: process.env.EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY || '',
                allowedEmails: process.env.EXPO_PUBLIC_ALLOWED_LOGIN_EMAILS || '',
            },
            mirrorCatalog: {
                url: process.env.EXPO_PUBLIC_MIRROR_SUPABASE_URL || process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL || '',
                anonKey: process.env.EXPO_PUBLIC_MIRROR_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY || '',
            },
            dabBeta: {
                baseUrl: process.env.EXPO_PUBLIC_DAB_BETA_BASE_URL || 'https://dabmusic.xyz',
            },
            spotify: {
                clientId: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || '',
                top50GlobalPlaylistId: process.env.EXPO_PUBLIC_SPOTIFY_TOP50_GLOBAL_PLAYLIST_ID || '37i9dQZEVXbMDoHDwVN2tF',
            },
            eas: {
                projectId: "f9cff190-672e-4832-add3-4a9cb3e68343"
            }
        }
    }
};



