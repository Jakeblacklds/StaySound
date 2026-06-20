/**
 * OptionRow
 *
 * Selectable row used inside the Tidal bottom sheets (server / quality /
 * settings): leading icon chip, title + description, optional status line, and
 * a trailing check when selected.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { radius, typeScale, useTheme, withAlpha } from '@/src/theme';

interface OptionRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description?: string;
    /** Small dim status line below the description (e.g. latency). */
    status?: string;
    statusTone?: 'default' | 'warning' | 'error' | 'success';
    selected?: boolean;
    disabled?: boolean;
    onPress: () => void;
}

export const OptionRow: React.FC<OptionRowProps> = ({
    icon,
    title,
    description,
    status,
    statusTone = 'default',
    selected = false,
    disabled = false,
    onPress,
}) => {
    const { theme } = useTheme();

    const statusColor =
        statusTone === 'warning' ? '#F59E0B'
        : statusTone === 'error' ? theme.colors.error
        : statusTone === 'success' ? '#10B981'
        : withAlpha(theme.colors.onSurfaceVariant, 'B0');

    const handlePress = () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
    };

    return (
        <Pressable
            onPress={handlePress}
            disabled={disabled}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: selected
                        ? withAlpha(theme.colors.primary, '1F')
                        : pressed
                            ? withAlpha(theme.colors.onSurface, '0A')
                            : 'transparent',
                    borderColor: selected ? withAlpha(theme.colors.primary, '66') : 'transparent',
                    opacity: disabled ? 0.5 : 1,
                },
            ]}
        >
            <View
                style={[
                    styles.iconChip,
                    { backgroundColor: withAlpha(selected ? theme.colors.primary : theme.colors.onSurface, '14') },
                ]}
            >
                <Ionicons
                    name={icon}
                    size={20}
                    color={selected ? theme.colors.primary : theme.colors.onSurface}
                />
            </View>
            <View style={styles.copy}>
                <Text numberOfLines={1} style={[styles.title, { color: theme.colors.onSurface }]}>{title}</Text>
                {description ? (
                    <Text numberOfLines={2} style={[styles.desc, { color: theme.colors.onSurfaceVariant }]}>{description}</Text>
                ) : null}
                {status ? (
                    <Text numberOfLines={1} style={[styles.status, { color: statusColor }]}>{status}</Text>
                ) : null}
            </View>
            {selected ? (
                <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
            ) : null}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: radius.lg,
        borderWidth: 1,
    },
    iconChip: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    copy: {
        flex: 1,
        gap: 2,
    },
    title: {
        ...typeScale.title,
    },
    desc: {
        ...typeScale.caption,
    },
    status: {
        ...typeScale.micro,
        marginTop: 1,
    },
});
