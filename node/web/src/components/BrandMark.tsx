type Props = {
  className?: string;
  size?: number;
};

/** Open-ring mark (option C). */
export function BrandMark({ className = "", size = 28 }: Props) {
  return (
    <img
      src="/icon.svg"
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-lg ${className}`}
    />
  );
}
