import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';

export function useScreenEntryKey(screenKey: string): number {
  const isFocused = useIsFocused();
  const hasAnimatedRef = useRef(false);
  const [entryKey] = useState(0);

  useEffect(() => {
    hasAnimatedRef.current = false;
  }, [screenKey]);

  useEffect(() => {
    if (!isFocused) return;
    if (!hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
    }
  }, [isFocused]);

  return entryKey;
}
