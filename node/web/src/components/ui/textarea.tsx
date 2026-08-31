import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[120px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none ring-primary/30 focus:ring-2",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
