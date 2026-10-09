import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { useUIStore } from '../../src/stores/uiStore';
import { useNotificationStore } from '../../src/stores/notificationStore';
import { dispatchShellAction } from '../../src/features/shell/dispatchShellAction';

beforeEach(() => {
    useUIStore.setState(useUIStore.getInitialState());
    useNotificationStore.setState(useNotificationStore.getInitialState());
});
test('notifications queue repeated messages and ignore stale acknowledgements', () => {
    const store = useNotificationStore.getState();
    store.showNotification('Listo', 'success');
    store.showNotification('Listo', 'success');
    const [first, second] = useNotificationStore.getState().queue;
    assert.notEqual(first.id, second.id);
    dispatchShellAction({ kind: 'notification', id: String(first.id), action: 'dismiss' });
    dispatchShellAction({ kind: 'notification', id: String(first.id), action: 'dismiss' });
    assert.deepEqual(useNotificationStore.getState().queue, [second]);
    store.hideNotification(second.id);
    assert.equal(useNotificationStore.getState().visible, false);
});
test('confirmation closes before callback and does not close its replacement', () => {
    const store = useUIStore.getState();
    let calls = 0;
    const next = { title: 'Otra', message: 'Segunda', onConfirm: () => {} };
    store.openConfirmModal({ title: 'Eliminar', message: 'Confirmar', onConfirm: () => {
        calls++;
        assert.equal(useUIStore.getState().confirmModalVisible, false);
        store.openConfirmModal(next);
    } });
    const event = { kind: 'confirmation', id: String(useUIStore.getState().confirmModalId), action: 'confirm' };
    dispatchShellAction(event);
    dispatchShellAction(event);
    assert.equal(calls, 1);
    assert.equal(useUIStore.getState().confirmModalVisible, true);
    assert.equal(useUIStore.getState().confirmModalConfig, next);
});
test('Back cancellation never invokes confirmation', () => {
    let calls = 0;
    useUIStore.getState().openConfirmModal({ title: '', message: '', onConfirm: () => { calls++; } });
    dispatchShellAction({ kind: 'confirmation', id: String(useUIStore.getState().confirmModalId), action: 'dismiss' });
    assert.equal(calls, 0);
    assert.equal(useUIStore.getState().confirmModalVisible, false);
});
test('sheet rejects stale, out of bounds and repeated selections', () => {
    let calls = 0;
    const store = useUIStore.getState();
    store.openActionSheet({ title: '', actions: [{ label: '', icon: '', onPress: () => { calls++; } }] });
    const id = String(useUIStore.getState().actionSheetId);
    dispatchShellAction({ kind: 'sheet', id: 'stale', action: 'select', index: 0 });
    dispatchShellAction({ kind: 'sheet', id, action: 'select', index: 2 });
    assert.equal(calls, 0);
    dispatchShellAction({ kind: 'sheet', id, action: 'select', index: 0 });
    dispatchShellAction({ kind: 'sheet', id, action: 'select', index: 0 });
    assert.equal(calls, 1);
    assert.equal(useUIStore.getState().actionSheetVisible, false);
});
test('confirmation blocks sheet actions until dismissed', () => {
    let calls = 0;
    const store = useUIStore.getState();
    store.openActionSheet({ title: '', actions: [{ label: '', icon: '', onPress: () => { calls++; } }] });
    store.openConfirmModal({ title: '', message: '', onConfirm: () => {} });
    dispatchShellAction({ kind: 'sheet', id: String(useUIStore.getState().actionSheetId), action: 'select', index: 0 });
    assert.equal(calls, 0);
    assert.equal(useUIStore.getState().actionSheetVisible, true);
});
test('sheet callback may open a confirmation without being overwritten', () => {
    const store = useUIStore.getState();
    store.openActionSheet({ title: '', actions: [{ label: '', icon: '', onPress: () => {
        assert.equal(useUIStore.getState().actionSheetVisible, false);
        store.openConfirmModal({ title: 'Confirmar', message: '', onConfirm: () => {} });
    } }] });
    dispatchShellAction({ kind: 'sheet', id: String(useUIStore.getState().actionSheetId), action: 'select', index: 0 });
    assert.equal(useUIStore.getState().confirmModalVisible, true);
});
