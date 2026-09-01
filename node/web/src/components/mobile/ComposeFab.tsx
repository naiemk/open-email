import { Pencil } from "lucide-react";

type Props = {
  onClick: () => void;
  disabled?: boolean;
};

export function ComposeFab({ onClick, disabled = false }: Props) {
  return (
    <button
      type="button"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 md:hidden"
      aria-label="New message"
      disabled={disabled}
      onClick={onClick}
    >
      <Pencil className="h-6 w-6" />
    </button>
  );
}
