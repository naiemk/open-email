import type { ReactNode } from "react";

export type ActionSheetItem = {
  label: string;
  icon?: ReactNode;
  className?: string;
  onClick: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: ActionSheetItem[];
};

export function ActionSheet({ open, onClose, items }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 md:hidden">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border border-border bg-white py-2 shadow-xl">
        {items.map((item, i) => (
          <button
            key={`${item.label}-${i}`}
            type="button"
            className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted ${item.className ?? ""}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
