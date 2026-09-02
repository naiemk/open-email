import { useT } from "@/i18n/I18nProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function NavDrawer({ open, onClose, children }: Props) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label={t("aria.closeNav")} onClick={onClose} />
      <div className="relative z-10 h-full w-[min(280px,85vw)] shadow-xl">{children}</div>
    </div>
  );
}
