import { Paperclip, X } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="Close" disabled={pending} onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1b1330] px-4 py-3 text-white">
          <span className="text-sm font-medium">{MODE_TITLE[mode]}</span>
          <button type="button" className="text-lg leading-none opacity-80 hover:opacity-100 disabled:opacity-40" disabled={pending} onClick={onClose}>
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
              disabled={pending}
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-12 text-sm text-muted-foreground">Subject</span>
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
          className="min-h-[220px] resize-none rounded-none border-0 focus-visible:ring-0"
        />
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
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
        {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <label className="cursor-pointer text-xs text-primary underline">
              Attach files
              <input type="file" multiple className="hidden" disabled={pending} onChange={(e) => void addFiles(e.target.files)} />
            </label>
            <span className="text-xs text-muted-foreground">End-to-end encrypted on send</span>
          </div>
          <Button className="rounded-full px-6" disabled={pending || !to.trim()} onClick={onSend}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
