import { useNotificationStore } from '@/src/stores/notificationStore';
import { useTheme } from '@/src/theme';
import React from 'react';
import { Portal, Snackbar } from 'react-native-paper';

export const GlobalNotification = () => {
    const { visible, message, type, queue, hideNotification } = useNotificationStore();
    const { theme } = useTheme();

    const getBackgroundColor = () => {
        switch (type) {
            case 'success': return theme.colors.primary;
            case 'error': return theme.colors.error;
            case 'warning': return '#f57c00'; // Orange
            default: return theme.colors.secondary;
        }
    };

    return (
        <Portal>
            <Snackbar
                key={queue[0]?.id ?? 0}
                visible={visible}
                onDismiss={() => hideNotification(queue[0]?.id)}
                duration={3000}
                style={{
                    backgroundColor: getBackgroundColor(),
                    borderRadius: 16,
                    marginBottom: 100, // Make sure it's above the miniplayer if needed
                }}
            >
                {message}
            </Snackbar>
        </Portal>
    );
};
