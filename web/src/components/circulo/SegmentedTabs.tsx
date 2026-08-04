interface SegmentedTabsProps<T extends string> {
  items: { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
}

/** Underline-style sub-nav, e.g. Biblioteca's Álbumes/Canciones/Artistas/Radio switcher —
    the Círculo desktop equivalent of the app's existing mobile-tabs pattern. */
export function SegmentedTabs<T extends string>({ items, active, onSelect, ariaLabel }: SegmentedTabsProps<T>) {
  return (
    <nav className="circ-segmented-tabs" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className={active === item.id ? 'active' : ''}
          aria-current={active === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
