import { getSoulseekCredentials, setSoulseekCredentials } from '@/src/services/soulseekDownloadService';
import { useNotificationStore } from '@/src/stores';
import { useCallback, useEffect, useState } from 'react';

export function useSoulseekCredentials() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [hasCredentials, setHasCredentials] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const showNotification = useNotificationStore(state => state.showNotification);

    useEffect(() => {
        let cancelled = false;

        void getSoulseekCredentials()
            .then(saved => {
                if (cancelled || !saved) return;
                setUsername(saved.username);
                setPassword(saved.password);
                setHasCredentials(true);
            })
            .catch(() => {
                // Credentials are optional until a Soulseek action is requested.
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const save = useCallback(async (): Promise<boolean> => {
        const normalizedUsername = username.trim();
        const normalizedPassword = password.trim();

        if (!normalizedUsername || !normalizedPassword) {
            showNotification('Usuario y password son obligatorios.', 'error');
            return false;
        }

        setIsSaving(true);
        try {
            await setSoulseekCredentials(normalizedUsername, normalizedPassword);
            setHasCredentials(true);
            showNotification('Sesion de Soulseek guardada.', 'success');
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'No se pudo guardar la sesion de Soulseek';
            showNotification(message, 'error');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [password, showNotification, username]);

    return {
        username,
        password,
        hasCredentials,
        isSaving,
        setUsername,
        setPassword,
        save,
    };
}
