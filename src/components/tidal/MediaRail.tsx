/**
 * MediaRail
 *
 * Generic horizontal carousel of TidalCoverCards. Replaces the ~4 near-identical
 * ScrollView rails (albums / artists / playlists / similar) scattered across the
 * Tidal screens.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { TidalCoverCard } from '@/src/components/ui';

export interface MediaRailItem {
    key: string;
    imageUri?: string;
    title?: string;
    subtitle?: string;
    fallbackIcon?: keyof typeof Ionicons.glyphMap;
    badge?: 'play';
    onPress: () => void;
}

interface MediaRailProps {
    items: MediaRailItem[];
    cardSize?: number;
    variant?: 'square' | 'circle';
    /** Glass tone tunes label colors for translucent atmosphere backgrounds. */
    tone?: 'default' | 'glass';
}

export const MediaRail: React.FC<MediaRailProps> = ({
    items,
    cardSize = 150,
    variant = 'square',
    tone = 'glass',
}) => {
    if (items.length === 0) return null;
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
        >
            {items.map((item) => (
                <TidalCoverCard
                    key={item.key}
                    imageUri={item.imageUri}
                    title={item.title}
                    subtitle={item.subtitle}
                    size={cardSize}
                    variant={variant}
                    fallbackIcon={item.fallbackIcon}
                    badge={item.badge}
                    tone={tone}
                    onPress={item.onPress}
                />
            ))}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    rail: {
        paddingHorizontal: 20,
        gap: 16,
    },
});
