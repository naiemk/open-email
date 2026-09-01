import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MailAttachment } from "@/lib/mail";
import { downloadAttachment } from "@/lib/mail";

type Props = {
  attachments: MailAttachment[];
};

export function AttachmentList({ attachments }: Props) {
  if (!attachments.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {attachments.map((att) => (
        <Button
          key={att.partId}
          type="button"
          variant="outline"
          className="h-auto gap-2 px-3 py-2 text-xs"
          onClick={() => downloadAttachment(att)}
        >
          <Paperclip className="h-3.5 w-3.5" />
          <span>{att.filename}</span>
          <span className="text-muted-foreground">({formatSize(att.size)})</span>
        </Button>
      ))}
    </div>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
