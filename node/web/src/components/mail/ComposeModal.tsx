import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  from: string;
  to: string;
  subject: string;
  body: string;
  error: string;
  onTo: (v: string) => void;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
};

export function ComposeModal({
  open,
  from,
  to,
  subject,
  body,
  error,
  onTo,
  onSubject,
  onBody,
  onSend,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1b1330] px-4 py-3 text-white">
          <span className="text-sm font-medium">New message</span>
          <button type="button" className="text-lg leading-none opacity-80 hover:opacity-100" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="space-y-0 border-b border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
            <span className="w-12 text-muted-foreground">From</span>
            <span>{from}</span>
          </div>
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="w-12 text-sm text-muted-foreground">To</span>
            <Input
              value={to}
              onChange={(e) => onTo(e.target.value)}
              placeholder="recipient@example.com"
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-12 text-sm text-muted-foreground">Subject</span>
            <Input
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              placeholder="Subject"
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <Textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder="Write your message…"
          className="min-h-[220px] resize-none rounded-none border-0 focus-visible:ring-0"
        />
        {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">End-to-end encrypted on send</span>
          <Button className="rounded-full px-6" onClick={onSend}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
