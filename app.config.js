const IS_DEV = process.env.APP_VARIANT === 'development';
const APP_VERSION = '1.0.1';
const ANDROID_VERSION_CODE = 2;
const EAS_PROJECT_ID = 'f9cff190-672e-4832-add3-4a9cb3e68343';
const OTA_CHANNEL = IS_DEV ? 'development' : 'production';
const RUNTIME_VERSION = `staysound-${IS_DEV ? 'dev' : 'prod'}-${APP_VERSION}-${ANDROID_VERSION_CODE}`;
const OTA_URL = `https://u.expo.dev/${EAS_PROJECT_ID}`;

module.exports = {
    expo: {
        name: IS_DEV ? 'StaySound dev' : 'StaySound',
        slug: 'StaySound',
        version: APP_VERSION,
        runtimeVersion: RUNTIME_VERSION,
        orientation: 'portrait',
        icon: './assets/images/appicon.png',
        scheme: 'staysound',
        assetBundlePatterns: [
            'assets/**',
        ],
        userInterfaceStyle: 'automatic',
        newArchEnabled: true,
        updates: {
            enabled: true,
            url: OTA_URL,
            checkAutomatically: 'NEVER',
            fallbackToCacheTimeout: 0,
            requestHeaders: {
                'expo-channel-name': OTA_CHANNEL,
            },
        },
        ios: {
            supportsTablet: true,
            bundleIdentifier: IS_DEV ? 'com.staysound.app.dev' : 'com.staysound.app.pro',
            infoPlist: {
                UIBackgroundModes: ['audio'],
                NSAppleMusicUsageDescription: 'StaySound needs access to your music library',
                NSPhotoLibraryUsageDescription: 'StaySound needs access to display album artwork',
            },
        },
        android: {
            adaptiveIcon: {
                foregroundImage: './assets/images/appicon.png',
                backgroundColor: '#0a0a0a',
            },
            edgeToEdgeEnabled: true,
            package: IS_DEV ? 'com.staysound.app.dev' : 'com.staysound.app.pro',
            versionCode: ANDROID_VERSION_CODE,
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            permissions: [
                'READ_EXTERNAL_STORAGE',
                'READ_MEDIA_AUDIO',
                'READ_MEDIA_IMAGES',
                'READ_MEDIA_VISUAL_USER_SELECTED',
                'FOREGROUND_SERVICE',
                'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
                'WAKE_LOCK',
                'MODIFY_AUDIO_SETTINGS',
                ...(!IS_DEV ? ['REQUEST_INSTALL_PACKAGES'] : []),
            ],
        },
        web: {
            bundler: 'metro',
            output: 'static',
            favicon: './assets/images/favicon.png',
        },
        plugins: [
            'expo-router',
            'expo-system-ui',
            [
                'expo-splash-screen',
                {
                    android: {
                        backgroundColor: '#080B12',
                        drawable: {
                            icon: './assets/splashscreen-transparent.xml',
                        },
                    },
                },
            ],
            [
                'expo-audio',
                {
                    microphonePermission: false,
                },
            ],
            'expo-sqlite',
            [
                'expo-media-library',
                {
                    photosPermission: 'Allow StaySound to access album artwork',
                    savePhotosPermission: false,
                    isAccessMediaLocationEnabled: false,
                },
            ],
        ],
        experiments: {
            typedRoutes: true,
        },
        extra: {
            router: {},
            authSupabase: {
                url: process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL || '',
                anonKey: process.env.EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY || '',
                allowedEmails: process.env.EXPO_PUBLIC_ALLOWED_LOGIN_EMAILS || '',
            },
            dabBeta: {
                baseUrl: process.env.EXPO_PUBLIC_DAB_BETA_BASE_URL || 'https://dabmusic.xyz',
            },
            soulseek: {
                username: process.env.SOULSEEK_USERNAME || '',
                password: process.env.SOULSEEK_PASSWORD || '',
                serverHost: process.env.SOULSEEK_SERVER_HOST || 'server.slsknet.org',
                serverPort: Number(process.env.SOULSEEK_SERVER_PORT || 2242),
                listenPort: Number(process.env.SOULSEEK_LISTEN_PORT || 2234),
                searchTimeoutMs: Number(process.env.SOULSEEK_SEARCH_TIMEOUT_MS || 9000),
                maxResults: Number(process.env.SOULSEEK_MAX_RESULTS || 180),
                clientVersion: Number(process.env.SOULSEEK_CLIENT_VERSION || 160),
            },
            spotify: {
                clientId: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || '',
                top50GlobalPlaylistId: process.env.EXPO_PUBLIC_SPOTIFY_TOP50_GLOBAL_PLAYLIST_ID || '37i9dQZEVXbMDoHDwVN2tF',
            },
            appUpdates: {
                otaChannel: OTA_CHANNEL,
                otaUrl: OTA_URL,
                runtimeVersion: RUNTIME_VERSION,
                releaseManifestUrl: process.env.EXPO_PUBLIC_APP_RELEASES_URL || '',
                binaryChannel: IS_DEV ? 'development' : 'prod',
                binaryUpdatesEnabled: !IS_DEV,
                packageName: IS_DEV ? 'com.staysound.app.dev' : 'com.staysound.app.pro',
            },
            eas: {
                projectId: EAS_PROJECT_ID,
            },
        },
    },
};
