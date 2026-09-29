import { DEFAULT_EQUALIZER_PRESETS } from '@/src/services/equalizerPresets';
import {
    applyAndroidEqualizerPreset, isAndroidEqualizerAvailable, openAndroidSystemEqualizerPanel,
    refreshAndroidEqualizerCapabilities, resetAndroidEqualizerToFlat,
    setAndroidEqualizerBandLevel, setAndroidEqualizerMode, syncAndroidEqualizerFromSettings,
} from '@/src/services/androidEqualizerService';
import { useNotificationStore, useSettingsStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { useI18n } from '@/src/i18n';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { router } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type EqualizerAction = { action: string; value: string; id: string };
type NativeProps = ViewProps & { snapshot: string; appearance: Record<string, string>; topInset: number; bottomInset: number; onAction: (event: NativeSyntheticEvent<EqualizerAction>) => void };
export const hasNativeEqualizerView = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundEqualizerView') !== null;
const NativeView = hasNativeEqualizerView ? requireNativeViewManager<NativeProps>('StaySoundEqualizerView') : null;

export default function NativeEqualizerScreen() {
    const { theme } = useTheme();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();
    const equalizer = useSettingsStore(s => s.equalizer);
    const capabilities = useSettingsStore(s => s.equalizerCapabilities);
    const language = useSettingsStore(s => s.language);
    const notify = useNotificationStore(s => s.showNotification);
    useEffect(() => {
        void (equalizer.enabled && equalizer.mode === 'app'
            ? syncAndroidEqualizerFromSettings() : refreshAndroidEqualizerCapabilities(false))
            .catch(() => notify(t('equalizer.errors.refresh'), 'error'));
    }, []); // Initialize once; subsequent changes go through the action handler.
    const appearance = useMemo(() => ({
        background: theme.colors.background, surface: theme.colors.surface,
        onSurface: theme.colors.onSurface, onSurfaceVariant: theme.colors.onSurfaceVariant,
        primary: theme.colors.primary,
    }), [theme]);
    const snapshot = JSON.stringify({
        language, mode: equalizer.mode, presetId: equalizer.presetId,
        available: isAndroidEqualizerAvailable() && !!capabilities?.available,
        attached: !!capabilities?.attached, canOpenSystemPanel: !!capabilities?.canOpenSystemPanel,
        bands: capabilities?.bands ?? [],
        presets: [
            ...DEFAULT_EQUALIZER_PRESETS.map(p => ({ id: p.id, label: t(p.labelKey as any) })),
            ...(capabilities?.nativePresets ?? []).map(p => ({ id: `native:${p.index}`, label: p.name })),
        ],
    });
    const onAction = useCallback(({ nativeEvent: { action, value, id } }: NativeSyntheticEvent<EqualizerAction>) => {
        const run = async () => {
            switch (action) {
                case 'back': router.back(); break;
                case 'refresh': await refreshAndroidEqualizerCapabilities(false); break;
                case 'mode': if (value === 'off' || value === 'app' || value === 'system') await setAndroidEqualizerMode(value); break;
                case 'systemPanel': await openAndroidSystemEqualizerPanel(); break;
                case 'preset': {
                    const nativeIndex = value.startsWith('native:') ? Number(value.slice(7)) : undefined;
                    if (nativeIndex !== undefined && !(capabilities?.nativePresets ?? []).some(p => p.index === nativeIndex)) break;
                    if (nativeIndex === undefined && !DEFAULT_EQUALIZER_PRESETS.some(p => p.id === value)) break;
                    await applyAndroidEqualizerPreset(value, nativeIndex);
                    break;
                }
                case 'reset': await resetAndroidEqualizerToFlat(); break;
                case 'band': {
                    const band = capabilities?.bands.find(item => item.index === Number(id));
                    const level = Number(value);
                    if (band && Number.isFinite(level)) await setAndroidEqualizerBandLevel(band, level);
                    break;
                }
            }
        };
        void run().catch(() => notify(t('equalizer.errors.bandUpdate'), 'error'));
    }, [capabilities, notify, t]);
    if (!NativeView) return null;
    return <NativeView style={styles.fill} snapshot={snapshot} appearance={appearance}
        topInset={insets.top} bottomInset={insets.bottom} onAction={onAction} />;
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
