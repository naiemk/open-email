import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ComposeAttachment } from "@/lib/mail";
import { deleteComposeAttachment, uploadComposeAttachment } from "@/lib/mail";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { useState } from "react";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

type Props = {
  open: boolean;
  mode: ComposeMode;
  mailboxName: string;
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
  onError: (message: string) => void;
  onSend: () => void;
  onClose: () => void;
};

const MODE_KEYS: Record<ComposeMode, MessageKey> = {
  new: "compose.new",
  reply: "compose.reply",
  replyAll: "compose.replyAll",
  forward: "compose.forward",
};

export function ComposeModal({
  open,
  mode,
  mailboxName,
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
  onError,
  onSend,
  onClose,
}: Props) {
  const t = useT();
  const [uploading, setUploading] = useState(false);

  if (!open) return null;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || uploading || pending) return;
    setUploading(true);
    onError("");
    const next = [...attachments];
    try {
      let stagedBytes = next.reduce((sum, a) => sum + a.size, 0);
      for (const file of files) {
        const uploaded = await uploadComposeAttachment(mailboxName, file, stagedBytes);
        next.push(uploaded);
        stagedBytes += uploaded.size;
      }
      onAttachments(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : t("errors.sendFailed"));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (att: ComposeAttachment) => {
    void deleteComposeAttachment(mailboxName, att.id);
    onAttachments(attachments.filter((a) => a.id !== att.id));
  };

  return (
    <div className="fixed inset-0 z-50 flex md:items-end md:justify-end md:p-6">
      <button
        type="button"
        className="absolute inset-0 hidden bg-black/20 md:block"
        aria-label={t("common.close")}
        disabled={pending}
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white md:h-auto md:max-h-[90vh] md:max-w-[640px] md:rounded-xl md:border md:border-border md:shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-[#1b1330] px-4 py-3 text-white">
          <span className="text-sm font-medium">{t(MODE_KEYS[mode])}</span>
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
            <span className="w-12 text-muted-foreground">{t("compose.from")}</span>
            <span className="truncate">{from}</span>
          </div>
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="w-12 shrink-0 text-sm text-muted-foreground">{t("compose.to")}</span>
            <Input
              value={to}
              onChange={(e) => onTo(e.target.value)}
              placeholder={t("compose.recipientPlaceholder")}
              disabled={pending}
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="w-12 shrink-0 text-sm text-muted-foreground">{t("compose.subject")}</span>
            <Input
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              placeholder={t("compose.subjectPlaceholder")}
              disabled={pending}
              className="border-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <Textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder={t("compose.writeMessage")}
          disabled={pending}
          className="min-h-0 flex-1 resize-none rounded-none border-0 focus-visible:ring-0 md:min-h-[220px] md:flex-none"
        />
        {attachments.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-4 py-2">
            {attachments.map((att) => (
              <span key={att.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                <Paperclip className="h-3 w-3" />
                {att.filename}
                <button
                  type="button"
                  className="ms-1"
                  disabled={pending || uploading}
                  onClick={() => removeAttachment(att)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="shrink-0 px-4 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-primary underline">
            <Paperclip className="h-4 w-4" />
            {uploading ? t("compose.uploading") : t("compose.attach")}
            <input
              type="file"
              multiple
              className="hidden"
              disabled={pending || uploading}
              onChange={(e) => void addFiles(e.target.files)}
            />
          </label>
          <Button className="rounded-full px-6" disabled={pending || uploading || !to.trim()} onClick={onSend}>
            {pending ? (
              t("compose.sending")
            ) : (
              <>
                <Send className="me-2 h-4 w-4 md:hidden" />
                {t("compose.send")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
