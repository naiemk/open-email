import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function Dialog({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center md:p-6">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className={cn("relative z-10 w-full max-w-lg max-h-[90dvh] overflow-auto", className)}>{children}</div>
    </div>
  );
}

export function DialogContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Card className={cn("shadow-xl", className)}>{children}</Card>;
}
