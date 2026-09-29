import { dispatchShellAction } from './dispatchShellAction';
import { NativeOverlayHost } from '@/modules/android-shell/src';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { useUIStore } from '@/src/stores/uiStore';
import { useTheme } from '@/src/theme';
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function NativeGlobalOverlays() {
    const ui = useUIStore();
    const notifications = useNotificationStore(s => s.queue);
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const snapshot = useMemo(() => JSON.stringify({
        confirmation: ui.confirmModalVisible && ui.confirmModalConfig ? {
            id: String(ui.confirmModalId), title: ui.confirmModalConfig.title,
            message: ui.confirmModalConfig.message, isDestructive: ui.confirmModalConfig.isDestructive,
            confirmLabel: ui.confirmModalConfig.confirmLabel || 'Confirmar',
            cancelLabel: ui.confirmModalConfig.cancelLabel || 'Cancelar',
        } : null,
        sheet: ui.actionSheetVisible ? {
            id: String(ui.actionSheetId), title: ui.actionSheetTitle,
            subtitle: ui.actionSheetSubtitle || ui.actionSheetTrack?.artist || '',
            artwork: ui.actionSheetTrack?.artwork || '',
            actions: ui.actionSheetActions.map(({ label, destructive }) => ({ label, destructive })),
        } : null,
        notifications: notifications.map(n => ({ ...n, id: String(n.id) })),
        colors: theme.colors, bottomInset: insets.bottom, leftInset: insets.left, rightInset: insets.right,
    }), [ui, notifications, theme.colors, insets.bottom, insets.left, insets.right]);
    return NativeOverlayHost ? <NativeOverlayHost style={styles.host} pointerEvents="box-none"
        snapshot={snapshot} onAction={({ nativeEvent }) => dispatchShellAction(nativeEvent)} /> : null;
}
const styles = StyleSheet.create({ host: { ...StyleSheet.absoluteFillObject, zIndex: 20000 } });
