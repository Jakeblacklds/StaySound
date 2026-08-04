import { ChevronLeftIcon } from '../icons';

interface CarouselChevronProps {
  onClick?: () => void;
  label?: string;
}

/** Circular "see more" control at the end of a Círculo rail. */
export function CarouselChevron({ onClick, label = 'Ver más' }: CarouselChevronProps) {
  return (
    <button type="button" className="circ-carousel-chevron" aria-label={label} onClick={onClick}>
      <span><ChevronLeftIcon size={18} /></span>
    </button>
  );
}
