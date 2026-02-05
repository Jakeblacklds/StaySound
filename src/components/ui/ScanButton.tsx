/**
 * ScanButton - Button to trigger library scan
 */

import { useTheme } from '@/src/theme';
import { ScanProgress } from '@/src/types';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, ProgressBar, Text } from 'react-native-paper';
import {
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming
} from 'react-native-reanimated';

interface ScanButtonProps {
    isScanning: boolean;
    progress?: ScanProgress | null;
    onScan: () => void;
}

export function ScanButton({ isScanning, progress, onScan }: ScanButtonProps) {
    const { theme } = useTheme();
    const rotation = useSharedValue(0);

    React.useEffect(() => {
        if (isScanning) {
            rotation.value = withRepeat(
                withTiming(360, { duration: 1500 }),
                -1, // infinite
                false
            );
        } else {
            rotation.value = 0;
        }
    }, [isScanning]);

    const animatedIconStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
    }));

    const progressValue = progress?.total
        ? progress.scanned / progress.total
        : 0;

    return (
        <View style={styles.container}>
            <Button
                mode="contained"
                icon={isScanning ? undefined : "folder-music"}
                onPress={onScan}
                loading={isScanning}
                disabled={isScanning}
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                labelStyle={{ color: theme.colors.onPrimary }}
            >
                {isScanning ? 'Scanning...' : 'Scan Music Library'}
            </Button>

            {isScanning && progress && (
                <View style={styles.progressContainer}>
                    <ProgressBar
                        progress={progressValue}
                        color={theme.colors.primary}
                        style={styles.progressBar}
                    />
                    <Text
                        variant="labelSmall"
                        style={{ color: theme.colors.onSurfaceVariant }}
                    >
                        {progress.scanned} of {progress.total} files
                    </Text>
                    <Text
                        variant="labelSmall"
                        numberOfLines={1}
                        style={[styles.currentFile, { color: theme.colors.onSurfaceVariant }]}
                    >
                        {progress.currentPath}
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
    },
    button: {
        borderRadius: 12,
    },
    progressContainer: {
        marginTop: 16,
        alignItems: 'center',
    },
    progressBar: {
        width: '100%',
        height: 4,
        borderRadius: 2,
        marginBottom: 8,
    },
    currentFile: {
        marginTop: 4,
        maxWidth: '80%',
    },
});
