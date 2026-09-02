import { useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MailAttachment } from "@/lib/mail";
import { downloadAttachment, previewKind } from "@/lib/mail";
import { AttachmentPreviewModal } from "@/components/mail/AttachmentPreviewModal";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  attachments: MailAttachment[];
};

export function AttachmentList({ attachments }: Props) {
  const t = useT();
  const [preview, setPreview] = useState<MailAttachment | null>(null);

  if (!attachments.length) return null;

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        {attachments.map((att) => {
          const kind = previewKind(att);
          const canPreview = kind !== "unsupported";
          return (
            <div key={att.partId} className="flex items-stretch overflow-hidden rounded-md border border-border">
              <Button
                type="button"
                variant="ghost"
                className="h-auto gap-2 rounded-none px-3 py-2 text-xs"
                onClick={() => (canPreview ? setPreview(att) : downloadAttachment(att))}
                title={canPreview ? t("mail.preview") : t("mail.download")}
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span>{att.filename}</span>
                <span className="text-muted-foreground">({formatSize(att.size)})</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-auto w-8 shrink-0 rounded-none border-l border-border"
                title={t("mail.download")}
                onClick={() => downloadAttachment(att)}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <AttachmentPreviewModal attachment={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
