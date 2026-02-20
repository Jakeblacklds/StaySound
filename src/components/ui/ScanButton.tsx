/**
 * ScanButton - Button with folder selection for library scan
 * Integrated with radical Super Themes
 */

import { useTheme } from '@/src/theme';
import { ScanProgress } from '@/src/types';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Chip, ProgressBar, Surface, Text } from 'react-native-paper';
import Animated, {
    FadeIn,
    FadeInDown,
    FadeOut,
    useSharedValue,
    withRepeat,
    withTiming
} from 'react-native-reanimated';

interface ScanButtonProps {
    isScanning: boolean;
    progress?: ScanProgress | null;
    onScan: (folderPath?: string) => void;
}

const FOLDER_OPTIONS = [
    { id: 'download', label: '📥 Download', path: '/storage/emulated/0/Download/' },
    { id: 'music', label: '🎵 Music', path: '/storage/emulated/0/Music/' },
    { id: 'all', label: '📱 All Folders', path: '' },
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ScanButton({ isScanning, progress, onScan }: ScanButtonProps) {
    const { theme } = useTheme();
    const [showFolders, setShowFolders] = useState(false);
    const [selectedFolder, setSelectedFolder] = useState(FOLDER_OPTIONS[0]);
    const rotation = useSharedValue(0);

    const globalStyles = theme.components.global;

    React.useEffect(() => {
        if (isScanning) {
            rotation.value = withRepeat(
                withTiming(360, { duration: 1500 }),
                -1,
                false
            );
        } else {
            rotation.value = 0;
        }
    }, [isScanning]);

    const handleStartScan = () => {
        setShowFolders(false);
        onScan(selectedFolder.path);
    };

    const progressValue = progress?.total ? progress.scanned / progress.total : 0;

    // Compact mode
    if (!showFolders && !isScanning) {
        return (
            <View style={styles.container}>
                <AnimatedPressable
                    entering={FadeIn}
                    onPress={() => setShowFolders(true)}
                    style={[
                        styles.compactButton,
                        {
                            backgroundColor: theme.colors.primaryContainer,
                            borderRadius: globalStyles.buttonRadius,
                            borderWidth: globalStyles.borderWidth,
                            borderColor: globalStyles.borderColor,
                        }
                    ]}
                >
                    <Text style={{ fontSize: 20 }}>🔍</Text>
                    <Text
                        variant="labelLarge"
                        style={{
                            color: theme.colors.onPrimaryContainer,
                            marginLeft: 8,
                            fontFamily: theme.typography.fontFamily.bold
                        }}
                    >
                        Scan for Music
                    </Text>
                </AnimatedPressable>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {showFolders && !isScanning && (
                <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut}>
                    <Surface
                        style={[
                            styles.folderCard,
                            {
                                backgroundColor: theme.colors.surfaceVariant,
                                borderRadius: globalStyles.buttonRadius,
                                borderWidth: globalStyles.borderWidth,
                                borderColor: globalStyles.borderColor,
                            }
                        ]}
                    >
                        <Text
                            variant="titleMedium"
                            style={{
                                color: theme.colors.onSurface,
                                marginBottom: 12,
                                fontWeight: '600',
                                fontFamily: theme.typography.fontFamily.bold
                            }}
                        >
                            Where's your music?
                        </Text>

                        <View style={styles.folderChips}>
                            {FOLDER_OPTIONS.map((folder) => (
                                <Chip
                                    key={folder.id}
                                    mode={selectedFolder.id === folder.id ? 'flat' : 'outlined'}
                                    selected={selectedFolder.id === folder.id}
                                    onPress={() => setSelectedFolder(folder)}
                                    style={[
                                        styles.chip,
                                        selectedFolder.id === folder.id && {
                                            backgroundColor: theme.colors.primaryContainer
                                        }
                                    ]}
                                    textStyle={{
                                        color: selectedFolder.id === folder.id
                                            ? theme.colors.onPrimaryContainer
                                            : theme.colors.onSurfaceVariant,
                                        fontFamily: theme.typography.fontFamily.medium
                                    }}
                                >
                                    {folder.label}
                                </Chip>
                            ))}
                        </View>

                        <View style={styles.buttonRow}>
                            <Button
                                mode="text"
                                onPress={() => setShowFolders(false)}
                                textColor={theme.colors.onSurfaceVariant}
                                labelStyle={{ fontFamily: theme.typography.fontFamily.medium }}
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                onPress={handleStartScan}
                                icon="magnify"
                                style={{
                                    borderRadius: globalStyles.buttonRadius,
                                    borderWidth: globalStyles.borderWidth,
                                    borderColor: globalStyles.borderColor,
                                }}
                                labelStyle={{ fontFamily: theme.typography.fontFamily.bold }}
                            >
                                Scan Now
                            </Button>
                        </View>
                    </Surface>
                </Animated.View>
            )}

            {isScanning && progress && (
                <Animated.View entering={FadeIn} style={styles.progressContainer}>
                    <View style={styles.scanningHeader}>
                        <Text style={{ fontSize: 24 }}>🎵</Text>
                        <Text
                            variant="titleMedium"
                            style={{
                                color: theme.colors.onSurface,
                                marginLeft: 8,
                                fontFamily: theme.typography.fontFamily.bold
                            }}
                        >
                            Finding your music...
                        </Text>
                    </View>

                    <ProgressBar
                        progress={progressValue}
                        color={theme.colors.primary}
                        style={styles.progressBar}
                    />

                    <Text
                        variant="bodySmall"
                        style={{
                            color: theme.colors.onSurfaceVariant,
                            marginTop: 8,
                            fontFamily: theme.typography.fontFamily.regular
                        }}
                    >
                        {progress.currentPath || `${progress.scanned} tracks found`}
                    </Text>
                </Animated.View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
    },
    compactButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 24,
    },
    folderCard: {
        padding: 20,
    },
    folderChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
    },
    chip: {
        marginRight: 4,
        marginBottom: 4,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    progressContainer: {
        padding: 20,
    },
    scanningHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    progressBar: {
        height: 8,
        borderRadius: 4,
    },
});
