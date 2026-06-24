import type { AppleWordLyricsCandidate } from '@/src/services/lyricsRepository';
import { useTheme } from '@/src/theme';
import { withAlpha } from '@/src/utils/colorContrast';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type LyricsSuggestionModalProps = {
    visible: boolean;
    options: AppleWordLyricsCandidate[];
    requestedTitle: string;
    requestedArtist: string;
    requestedDurationSec?: number;
    accentColor: string;
    onSelect: (optionId: string) => void;
    onClose: () => void;
};

function formatDuration(durationSec?: number) {
    if (!durationSec || durationSec <= 0) return null;
    const rounded = Math.round(durationSec);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDurationDelta(candidateDuration?: number, requestedDuration?: number) {
    if (!candidateDuration || !requestedDuration) return null;
    const delta = Math.round(candidateDuration - requestedDuration);
    if (delta === 0) return 'misma duracion';
    return `${delta > 0 ? '+' : ''}${delta}s`;
}

export const LyricsSuggestionModal = React.memo(function LyricsSuggestionModal({
    visible,
    options,
    requestedTitle,
    requestedArtist,
    requestedDurationSec,
    accentColor,
    onSelect,
    onClose,
}: LyricsSuggestionModalProps) {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const surfaceColor = isDark ? '#151519' : '#F7F7F9';
    const primaryText = theme.colors.onSurface;
    const secondaryText = theme.colors.onSurfaceVariant;
    const dividerColor = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)';

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar selector de letras"
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />

                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: surfaceColor,
                            paddingBottom: Math.max(insets.bottom, 16),
                        },
                    ]}
                >
                    <View style={styles.handleWrap}>
                        <View style={[styles.handle, { backgroundColor: secondaryText }]} />
                    </View>

                    <View style={styles.header}>
                        <View style={styles.headerCopy}>
                            <Text style={[styles.heading, { color: primaryText }]}>
                                Elige la letra correcta
                            </Text>
                            <Text numberOfLines={2} style={[styles.requestedTrack, { color: secondaryText }]}>
                                {requestedTitle} / {requestedArtist}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cerrar"
                            hitSlop={8}
                            style={({ pressed }) => [
                                styles.closeButton,
                                pressed && { backgroundColor: dividerColor },
                            ]}
                            onPress={onClose}
                        >
                            <MaterialCommunityIcons name="close" size={22} color={primaryText} />
                        </Pressable>
                    </View>

                    <View style={[styles.divider, { backgroundColor: dividerColor }]} />

                    <ScrollView
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {options.map((option, index) => {
                            const duration = formatDuration(option.durationSec);
                            const durationDelta = formatDurationDelta(option.durationSec, requestedDurationSec);
                            const providerTag = [
                                option.providerLabel,
                                option.wordLevel ? 'palabra' : 'línea',
                            ].filter(Boolean).join(' · ');
                            const metadata = [
                                option.albumName,
                                duration,
                                durationDelta,
                            ].filter(Boolean).join(' / ');

                            return (
                                <React.Fragment key={option.id}>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Usar letras de ${option.trackName ?? option.label}`}
                                        style={({ pressed }) => [
                                            styles.optionRow,
                                            pressed && { backgroundColor: dividerColor },
                                        ]}
                                        onPress={() => onSelect(option.id)}
                                    >
                                        <View style={[styles.optionIndex, { backgroundColor: withAlpha(accentColor, 0.1) }]}>
                                            <Text style={[styles.optionIndexText, { color: accentColor }]}>
                                                {index + 1}
                                            </Text>
                                        </View>
                                        <View style={styles.optionCopy}>
                                            <Text numberOfLines={1} style={[styles.optionTitle, { color: primaryText }]}>
                                                {option.trackName ?? option.label}
                                            </Text>
                                            <Text numberOfLines={1} style={[styles.optionArtist, { color: secondaryText }]}>
                                                {option.artistName ?? requestedArtist}
                                            </Text>
                                            {providerTag ? (
                                                <View style={[styles.providerBadge, { backgroundColor: withAlpha(accentColor, 0.12) }]}>
                                                    <Text numberOfLines={1} style={[styles.providerBadgeText, { color: accentColor }]}>
                                                        {providerTag}
                                                    </Text>
                                                </View>
                                            ) : null}
                                            {metadata ? (
                                                <Text numberOfLines={1} style={[styles.optionMeta, { color: secondaryText }]}>
                                                    {metadata}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <MaterialCommunityIcons
                                            name="chevron-right"
                                            size={22}
                                            color={secondaryText}
                                        />
                                    </Pressable>
                                    {index < options.length - 1 ? (
                                        <View style={[styles.rowDivider, { backgroundColor: dividerColor }]} />
                                    ) : null}
                                </React.Fragment>
                            );
                        })}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
});

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.52)',
    },
    sheet: {
        maxHeight: '68%',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
    },
    handleWrap: {
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    handle: {
        width: 34,
        height: 4,
        borderRadius: 2,
        opacity: 0.34,
    },
    header: {
        minHeight: 72,
        paddingHorizontal: 20,
        paddingBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    headerCopy: {
        flex: 1,
        minWidth: 0,
    },
    heading: {
        fontSize: 20,
        lineHeight: 25,
        fontWeight: '700',
        letterSpacing: 0,
    },
    requestedTrack: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: 0,
    },
    closeButton: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    divider: {
        height: StyleSheet.hairlineWidth,
    },
    list: {
        flexGrow: 0,
    },
    listContent: {
        paddingVertical: 4,
    },
    optionRow: {
        minHeight: 82,
        paddingHorizontal: 20,
        paddingVertical: 13,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    optionIndex: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionIndexText: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '700',
        letterSpacing: 0,
    },
    optionCopy: {
        flex: 1,
        minWidth: 0,
    },
    optionTitle: {
        fontSize: 16,
        lineHeight: 21,
        fontWeight: '600',
        letterSpacing: 0,
    },
    optionArtist: {
        marginTop: 2,
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 0,
    },
    optionMeta: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 0,
        opacity: 0.8,
    },
    providerBadge: {
        alignSelf: 'flex-start',
        marginTop: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
    },
    providerBadgeText: {
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    rowDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 70,
    },
});
