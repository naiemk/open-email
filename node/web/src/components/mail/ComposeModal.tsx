import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ComposeAttachment } from "@/lib/mail";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

type Props = {
  open: boolean;
  mode: ComposeMode;
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: ComposeAttachment[];
  error: string;
  pending?: boolean;
  onTo: (v: string) => void;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  onAttachments: (attachments: ComposeAttachment[]) => void;
  onSend: () => void;
  onClose: () => void;
};

const MODE_TITLE: Record<ComposeMode, string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

export function ComposeModal({
  open,
  mode,
  from,
  to,
  subject,
  body,
  attachments,
  error,
  pending = false,
  onTo,
  onSubject,
  onBody,
  onAttachments,
  onSend,
  onClose,
}: Props) {
  if (!open) return null;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...attachments];
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      next.push({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: btoa(binary),
      });
    }
    onAttachments(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex md:items-end md:justify-end md:p-6">
      <button
        type="button"
        className="absolute inset-0 hidden bg-black/20 md:block"
        aria-label="Close"
        disabled={pending}
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white md:h-auto md:max-h-[90vh] md:max-w-[640px] md:rounded-xl md:border md:border-border md:shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-[#1b1330] px-4 py-3 text-white">
          <span className="text-sm font-medium">{MODE_TITLE[mode]}</span>
          <button
            type="button"
            className="text-lg leading-none opacity-80 hover:opacity-100 disabled:opacity-40"
            disabled={pending}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="shrink-0 space-y-0 border-b border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
            <span className="w-12 text-muted-foreground">From</span>
            <span className="truncate">{from}</span>
          </div>
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="w-12 shrink-0 text-sm text-muted-foreground">To</span>
            <Input
              value={to}
              onChange={(e) => onTo(e.target.value)}
              placeholder="recipient@example.com"
              disabled={pending}
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-12 shrink-0 text-sm text-muted-foreground">Subject</span>
            <Input
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              placeholder="Subject"
              disabled={pending}
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <Textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder="Write your message…"
          disabled={pending}
          className="min-h-0 flex-1 resize-none rounded-none border-0 focus-visible:ring-0 md:min-h-[220px] md:flex-none"
        />
        {attachments.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-4 py-2">
            {attachments.map((att, i) => (
              <span key={`${att.filename}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                <Paperclip className="h-3 w-3" />
                {att.filename}
                <button
                  type="button"
                  className="ml-1"
                  disabled={pending}
                  onClick={() => onAttachments(attachments.filter((_, j) => j !== i))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {error ? <p className="shrink-0 px-4 text-sm text-destructive">{error}</p> : null}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-primary underline">
            <Paperclip className="h-4 w-4" />
            Attach
            <input type="file" multiple className="hidden" disabled={pending} onChange={(e) => void addFiles(e.target.files)} />
          </label>
          <Button className="rounded-full px-6" disabled={pending || !to.trim()} onClick={onSend}>
            {pending ? (
              "Sending…"
            ) : (
              <>
                <Send className="mr-2 h-4 w-4 md:hidden" />
                Send
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
