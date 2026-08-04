import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 821px)';

/** The single breakpoint the app already uses to gate its desktop-only structural CSS
    (see app.css's "Sala de escucha" `@media (min-width: 821px)` block). The Círculo shell
    reads this to pick which screen/shell components to mount, so a phone-width browser
    tab never mounts a desktop component (and its side effects) alongside the mobile one. */
export function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true
  ));

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
