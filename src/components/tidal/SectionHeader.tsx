/**
 * SectionHeader
 *
 * Eyebrow/kicker + title + optional trailing action. Used across every Tidal
 * screen so section typography stays consistent with the redesign language.
 */
import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { typeScale, useTheme, withAlpha } from '@/src/theme';

interface SectionHeaderProps {
    /** Small uppercase label above the title (e.g. "PARA TI"). */
    kicker?: string;
    title: string;
    /** Right-aligned meta text (e.g. "12 pistas"). */
    meta?: string;
    /** Optional tappable action (renders `actionLabel`). */
    onActionPress?: () => void;
    actionLabel?: string;
    /** Accent color for the kicker/action (defaults to theme primary). */
    accent?: string;
    style?: StyleProp<ViewStyle>;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
    kicker,
    title,
    meta,
    onActionPress,
    actionLabel,
    accent,
    style,
}) => {
    const { theme } = useTheme();
    const accentColor = accent ?? theme.colors.primary;

    return (
        <View style={[styles.row, style]}>
            <View style={styles.left}>
                {kicker ? (
                    <Text style={[styles.kicker, { color: accentColor }]}>{kicker.toUpperCase()}</Text>
                ) : null}
                <Text numberOfLines={1} style={[styles.title, { color: theme.colors.onBackground }]}>
                    {title}
                </Text>
            </View>
            {actionLabel && onActionPress ? (
                <Pressable hitSlop={10} onPress={onActionPress}>
                    <Text style={[styles.action, { color: accentColor }]}>{actionLabel}</Text>
                </Pressable>
            ) : meta ? (
                <Text style={[styles.meta, { color: withAlpha(theme.colors.onSurfaceVariant, 'C0') }]}>{meta}</Text>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        marginBottom: 14,
        gap: 12,
    },
    left: {
        flex: 1,
        gap: 4,
    },
    kicker: {
        ...typeScale.micro,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    title: {
        ...typeScale.titleLarge,
    },
    action: {
        ...typeScale.label,
    },
    meta: {
        ...typeScale.caption,
    },
});
