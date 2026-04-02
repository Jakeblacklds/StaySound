import { usePlayerStore } from '@/src/stores';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';

export default function NotificationClickScreen() {
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!rootNavigationState?.key) {
      return;
    }

    const { currentTrack, setPlayerVisible } = usePlayerStore.getState();

    if (currentTrack != null) {
      setPlayerVisible(true);
    }

    router.replace('/');
  }, [rootNavigationState?.key]);

  return null;
}
