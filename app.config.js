const IS_DEV = process.env.APP_VARIANT === 'development';
const APP_VERSION = '1.0.2';
const ANDROID_VERSION_CODE = 3;
const EAS_PROJECT_ID = '14ef09db-f61a-4de2-a6be-b58717ac2494';
const OTA_CHANNEL = IS_DEV ? 'development' : 'production';
const RUNTIME_VERSION = `staysound-${IS_DEV ? 'dev' : 'prod'}-${APP_VERSION}-${ANDROID_VERSION_CODE}`;
const OTA_URL = `https://u.expo.dev/${EAS_PROJECT_ID}`;
const BINARY_CHANNEL = IS_DEV ? 'development' : 'prod';
const RELEASES_BUCKET = process.env.APP_RELEASES_STORAGE_BUCKET || 'staysound-releases';
const SUPABASE_URL = (process.env.EXPO_PUBLIC_AUTH_SUPABASE_URL || '').replace(/\/+$/, '');
const RELEASE_MANIFEST_URL =
    process.env.EXPO_PUBLIC_APP_RELEASES_URL ||
    (SUPABASE_URL
        ? `${SUPABASE_URL}/storage/v1/object/public/${RELEASES_BUCKET}/android/${BINARY_CHANNEL}/manifest.json`
        : '');

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
                NSLocalNetworkUsageDescription: 'StaySound connects to your trusted Soulseek bridge to download music you select.',
                NSAppTransportSecurity: {
                    NSAllowsLocalNetworking: true,
                },
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
                'expo-font',
                {
                    android: {
                        fonts: [
                            {
                                fontFamily: 'StaySound',
                                fontDefinitions: [
                                    {
                                        path: './assets/fonts/apple/SFPRODISPLAYREGULAR.ttf',
                                        weight: 400,
                                    },
                                    {
                                        path: './assets/fonts/apple/SFPRODISPLAYMEDIUM.ttf',
                                        weight: 500,
                                    },
                                    {
                                        path: './assets/fonts/apple/SFPRODISPLAYBOLD.ttf',
                                        weight: 700,
                                    },
                                    {
                                        path: './assets/fonts/apple/SFPRODISPLAYSEMIBOLDITALIC.ttf',
                                        weight: 600,
                                        style: 'italic',
                                    },
                                ],
                            },
                        ],
                    },
                    ios: {
                        fonts: [
                            './assets/fonts/apple/SFPRODISPLAYREGULAR.ttf',
                            './assets/fonts/apple/SFPRODISPLAYMEDIUM.ttf',
                            './assets/fonts/apple/SFPRODISPLAYBOLD.ttf',
                            './assets/fonts/apple/SFPRODISPLAYSEMIBOLDITALIC.ttf',
                        ],
                    },
                },
            ],
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
            './plugins/withAndroidAutoCatalogModule',
            './plugins/withKaraokeFonts',
            './plugins/withAndroidNavigation',
            './plugins/withAndroidCore',
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
            amazonMusic: {
                baseUrl: process.env.EXPO_PUBLIC_AMAZON_MUSIC_BASE_URL || 'https://amz.geeked.wtf',
                bypassToken: process.env.EXPO_PUBLIC_AMAZON_MUSIC_BYPASS_TOKEN || '',
                turnstileJwt: process.env.EXPO_PUBLIC_AMAZON_TURNSTILE_JWT || '',
            },
            deezerFallback: {
                baseUrl: process.env.EXPO_PUBLIC_DEEZER_FALLBACK_BASE_URL || 'https://dzr.tabs-vs-spaces.wtf',
            },
            soulseek: {
                username: process.env.SOULSEEK_USERNAME || '',
                password: process.env.SOULSEEK_PASSWORD || '',
                bridgeUrl: process.env.EXPO_PUBLIC_SOULSEEK_BRIDGE_URL || '',
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
                releaseManifestUrl: RELEASE_MANIFEST_URL,
                binaryChannel: BINARY_CHANNEL,
                binaryUpdatesEnabled: !IS_DEV,
                packageName: IS_DEV ? 'com.staysound.app.dev' : 'com.staysound.app.pro',
            },
            eas: {
                projectId: EAS_PROJECT_ID,
            },
        },
    },
};
