import { useLibraryStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { ThemeStyle } from '@/src/types/theme';
import React from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Divider, List, Switch, Text } from 'react-native-paper';

export default function SettingsScreen() {
    const { theme, config, setThemeStyle, setThemeMode, toggleDynamicColors, isDark } = useTheme();
    const { isScanning, scanLibrary, getAllTracks, lastScanDate } = useLibraryStore();

    const trackCount = getAllTracks().length;
    const lastScan = lastScanDate
        ? new Date(lastScanDate).toLocaleDateString()
        : 'Never';

    const handleScan = async () => {
        try {
            await scanLibrary();
            Alert.alert('Scan Complete', `Found ${getAllTracks().length} tracks!`);
        } catch (error) {
            Alert.alert('Scan Error', 'Failed to scan music library');
        }
    };

    const themeStyles: { label: string; value: ThemeStyle }[] = [
        { label: '🍎 Minimal (Apple-like)', value: 'minimal' },
        { label: '🎨 Material 3 Expressive', value: 'material3' },
        { label: '💚 Spotify', value: 'spotify' },
    ];

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={styles.content}
        >
            {/* Appearance Section */}
            <Text
                variant="titleSmall"
                style={[styles.sectionHeader, { color: theme.colors.primary }]}
            >
                APPEARANCE
            </Text>

            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                <List.Item
                    title="Dark Mode"
                    description={config.mode === 'system' ? 'Following system' : isDark ? 'On' : 'Off'}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <List.Icon {...props} icon="brightness-6" color={theme.colors.primary} />}
                    right={() => (
                        <Switch
                            value={isDark}
                            onValueChange={() => setThemeMode(isDark ? 'light' : 'dark')}
                        />
                    )}
                />
                <Divider />
                <List.Item
                    title="Dynamic Colors"
                    description="Extract colors from album art"
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <List.Icon {...props} icon="palette" color={theme.colors.primary} />}
                    right={() => (
                        <Switch
                            value={config.dynamicColors}
                            onValueChange={toggleDynamicColors}
                        />
                    )}
                />
            </View>

            {/* Theme Style */}
            <Text
                variant="titleSmall"
                style={[styles.sectionHeader, { color: theme.colors.primary }]}
            >
                THEME STYLE
            </Text>

            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                {themeStyles.map((item, index) => (
                    <React.Fragment key={item.value}>
                        <List.Item
                            title={item.label}
                            titleStyle={{ color: theme.colors.onSurface }}
                            left={(props) => (
                                <List.Icon
                                    {...props}
                                    icon={config.style === item.value ? "radiobox-marked" : "radiobox-blank"}
                                    color={theme.colors.primary}
                                />
                            )}
                            onPress={() => setThemeStyle(item.value)}
                        />
                        {index < themeStyles.length - 1 && <Divider />}
                    </React.Fragment>
                ))}
            </View>

            {/* Playback Section */}
            <Text
                variant="titleSmall"
                style={[styles.sectionHeader, { color: theme.colors.primary }]}
            >
                PLAYBACK
            </Text>

            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                <List.Item
                    title="Equalizer"
                    description="Adjust audio frequencies"
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <List.Icon {...props} icon="equalizer" color={theme.colors.primary} />}
                    right={(props) => <List.Icon {...props} icon="chevron-right" color={theme.colors.onSurfaceVariant} />}
                />
                <Divider />
                <List.Item
                    title="Sleep Timer"
                    description="Off"
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <List.Icon {...props} icon="timer-outline" color={theme.colors.primary} />}
                    right={(props) => <List.Icon {...props} icon="chevron-right" color={theme.colors.onSurfaceVariant} />}
                />
            </View>

            {/* Library Section */}
            <Text
                variant="titleSmall"
                style={[styles.sectionHeader, { color: theme.colors.primary }]}
            >
                LIBRARY
            </Text>

            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                <List.Item
                    title="Scan for Music"
                    description={isScanning ? 'Scanning...' : `${trackCount} tracks • Last scan: ${lastScan}`}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <List.Icon {...props} icon="folder-music" color={theme.colors.primary} />}
                    right={(props) => isScanning
                        ? <ActivityIndicator size="small" color={theme.colors.primary} />
                        : <List.Icon {...props} icon="refresh" color={theme.colors.onSurfaceVariant} />
                    }
                    onPress={handleScan}
                    disabled={isScanning}
                />
            </View>


            {/* About */}
            <View style={styles.about}>
                <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
                >
                    StaySound v1.0.0
                </Text>
                <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}
                >
                    Made with ❤️ using Expo SDK 54
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 16,
        paddingBottom: 120,
    },
    sectionHeader: {
        marginTop: 24,
        marginBottom: 8,
        marginLeft: 8,
        fontWeight: '600',
    },
    section: {
        borderRadius: 16,
        overflow: 'hidden',
    },
    about: {
        marginTop: 40,
        alignItems: 'center',
    },
});
