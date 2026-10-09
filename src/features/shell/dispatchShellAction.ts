import type { ShellAction } from '@/modules/android-shell/src';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { useUIStore } from '@/src/stores/uiStore';

// Close before invoking callbacks: a callback may synchronously open the next dialog.
export function dispatchShellAction(event: ShellAction) {
    const ui = useUIStore.getState();
    if (event.kind === 'notification' && event.action === 'dismiss') {
        useNotificationStore.getState().hideNotification(Number(event.id));
    } else if (event.kind === 'confirmation' && ui.confirmModalVisible && String(ui.confirmModalId) === event.id) {
        if (event.action !== 'confirm' && event.action !== 'dismiss') return;
        const callback = event.action === 'confirm' ? ui.confirmModalConfig?.onConfirm : undefined;
        ui.closeConfirmModal();
        callback?.();
    } else if (event.kind === 'sheet' && !ui.confirmModalVisible && ui.actionSheetVisible && String(ui.actionSheetId) === event.id) {
        if (event.action === 'dismiss') { ui.closeActionSheet(); return; }
        if (event.action !== 'select' || !Number.isInteger(event.index)) return;
        const action = ui.actionSheetActions[event.index!];
        if (!action) return;
        ui.closeActionSheet();
        action.onPress();
    }
}

