import { create } from 'zustand';

export type NotificationType = 'info' | 'success' | 'error' | 'warning';
export type NotificationItem = { id: number; message: string; type: NotificationType };

interface NotificationState {
    visible: boolean;
    message: string;
    type: NotificationType;
    queue: NotificationItem[];
    nextId: number;
    showNotification: (message: string, type?: NotificationType) => void;
    hideNotification: (id?: number) => void;
}

// One queue for native and fallback renderers. IDs distinguish identical messages.
export const useNotificationStore = create<NotificationState>((set) => ({
    visible: false, message: '', type: 'info', queue: [], nextId: 1,
    showNotification: (message, type = 'info') => set(state => {
        const queue = [...state.queue, { id: state.nextId, message, type }];
        return { queue, nextId: state.nextId + 1, visible: true,
            message: queue[0].message, type: queue[0].type };
    }),
    hideNotification: id => set(state => {
        if (!state.queue.length || (id !== undefined && state.queue[0].id !== id)) return state;
        const queue = state.queue.slice(1);
        return { queue, visible: queue.length > 0,
            message: queue[0]?.message ?? '', type: queue[0]?.type ?? 'info' };
    }),
}));
