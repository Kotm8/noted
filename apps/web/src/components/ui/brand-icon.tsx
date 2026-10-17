interface BrandIconProps {
  className?: string;
  decorative?: boolean;
}

export function BrandIcon({ className = "brand-symbol", decorative = false }: BrandIconProps) {
  return (
    <img
      className={className}
      src="/noted-icon.svg"
      alt={decorative ? "" : "Noted"}
      width={48}
      height={48}
      draggable={false}
    />
  );
}
