import { usePlayerStore } from '@/src/stores';
import { router } from 'expo-router';
import { useEffect } from 'react';

export default function NotificationClickScreen() {
  useEffect(() => {
    const { currentTrack, setPlayerVisible } = usePlayerStore.getState();

    if (currentTrack != null) {
      setPlayerVisible(true);
    }

    router.replace('/');
  }, []);

  return null;
}
