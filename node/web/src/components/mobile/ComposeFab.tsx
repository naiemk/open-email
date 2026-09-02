import { PenSquare } from "lucide-react";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  disabled?: boolean;
  onClick: () => void;
};

export function ComposeFab({ disabled, onClick }: Props) {
  const t = useT();

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t("aria.newMessage")}
      className="fixed end-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg disabled:opacity-50 md:hidden"
      onClick={onClick}
    >
      <PenSquare className="h-6 w-6" />
    </button>
  );
}
