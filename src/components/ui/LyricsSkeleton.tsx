import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Skeleton } from './Skeleton';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * LyricsSkeleton - UI for loading state of lyrics
 * Now includes the "Downloading" status as a specialized skeleton bar at the bottom
 */
export const LyricsSkeleton = ({ isDownloading = false }: { isDownloading?: boolean }) => {
    return (
        <View style={styles.container}>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.7} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.5} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.8} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.6} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.45} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.75} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.55} borderRadius={4} />
            </View>
            <View style={styles.line}>
                <Skeleton height={28} width={SCREEN_WIDTH * 0.65} borderRadius={4} />
            </View>

            {/* Specialized Status Bar at the bottom matching skeleton style */}
            {isDownloading && (
                <View style={[styles.line, { marginTop: 40 }]}>
                    <View style={styles.statusLineWrapper}>
                        <Skeleton height={40} width={SCREEN_WIDTH * 0.6} borderRadius={20} />
                        <View style={styles.statusTextOverlay}>
                            <Text style={styles.statusText}>Sincronizando con LRCLIB...</Text>
                        </View>
                    </View>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: SCREEN_WIDTH,
        flex: 1,
        paddingHorizontal: 32,
        paddingTop: SCREEN_HEIGHT * 0.28, // Subido un poco respecto al 0.35 para que encaje mejor visualmente
        gap: 32,
        backgroundColor: 'transparent',
    },
    line: {
        width: '100%',
        alignItems: 'flex-start',
    },
    statusLineWrapper: {
        position: 'relative',
        justifyContent: 'center',
    },
    statusTextOverlay: {
        position: 'absolute',
        left: 20,
        right: 0,
    },
    statusText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 1,
        textTransform: 'uppercase',
    }
});
