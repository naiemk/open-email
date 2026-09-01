import { useEffect, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function NavDrawer({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-[min(85vw,320px)] flex-col shadow-xl">{children}</aside>
    </div>
  );
}
