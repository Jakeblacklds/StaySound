import { useEffect, useState } from 'react';

const visitedScreens = new Set<string>();

export function useFirstScreenEntry(screenKey: string): boolean {
  const [shouldAnimate] = useState(() => !visitedScreens.has(screenKey));

  useEffect(() => {
    visitedScreens.add(screenKey);
  }, [screenKey]);

  return shouldAnimate;
}
