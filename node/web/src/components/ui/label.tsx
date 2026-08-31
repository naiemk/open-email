import { cn } from "@/lib/utils";

export function Label({ className, children, htmlFor }: { className?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}>
      {children}
    </label>
  );
}
