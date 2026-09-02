import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Download } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  attachmentToBlob,
  downloadAttachment,
  previewKind,
  type MailAttachment,
} from "@/lib/mail";
import { useT } from "@/i18n/I18nProvider";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Props = {
  attachment: MailAttachment | null;
  onClose: () => void;
};

function useAttachmentBlobUrl(att: MailAttachment | null): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!att) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(attachmentToBlob(att));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [att]);

  return url;
}

export function AttachmentPreviewModal({ attachment, onClose }: Props) {
  const t = useT();
  const blobUrl = useAttachmentBlobUrl(attachment);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    setPage(1);
    setNumPages(0);
  }, [attachment?.partId]);

  if (!attachment) return null;

  const kind = previewKind(attachment);
  const text =
    kind === "text" ? new TextDecoder().decode(attachment.content) : "";

  return (
    <Dialog open={Boolean(attachment)} onClose={onClose} className="max-w-4xl">
      <DialogContent className="flex max-h-[90dvh] w-full flex-col gap-3 overflow-hidden p-4">
        <header className="flex shrink-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("mail.preview")}</p>
            <h3 className="truncate text-sm font-semibold">{attachment.filename}</h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => downloadAttachment(attachment)}
          >
            <Download className="h-3.5 w-3.5" />
            {t("mail.download")}
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-2">
          {kind === "image" && blobUrl ? (
            <img
              src={blobUrl}
              alt={attachment.filename}
              className="mx-auto max-h-[70vh] max-w-full object-contain"
            />
          ) : null}

          {kind === "pdf" && blobUrl ? (
            <div className="flex flex-col items-center gap-2">
              <Document
                file={blobUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={<p className="p-4 text-sm text-muted-foreground">…</p>}
              >
                <Page pageNumber={page} width={Math.min(typeof window !== "undefined" ? window.innerWidth - 64 : 800, 800)} />
              </Document>
              {numPages > 1 ? (
                <div className="flex items-center gap-3 py-2 text-sm">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("mail.previewPrev")}
                  </Button>
                  <span>
                    {page} / {numPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= numPages}
                    onClick={() => setPage((p) => Math.min(numPages, p + 1))}
                  >
                    {t("mail.previewNext")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {kind === "text" ? (
            <pre className="whitespace-pre-wrap break-words p-2 font-mono text-xs">{text}</pre>
          ) : null}

          {kind === "video" && blobUrl ? (
            <video src={blobUrl} controls className="mx-auto max-h-[70vh] max-w-full" />
          ) : null}

          {kind === "unsupported" ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-sm text-muted-foreground">{t("mail.previewUnsupported")}</p>
              <Button type="button" onClick={() => downloadAttachment(attachment)}>
                {t("mail.download")}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
