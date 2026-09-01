import { useEffect, useState } from "react";
import type { Mail } from "@/lib/mail";
import { getHtmlForView, hasHtmlBody, wrapHtmlForView } from "@/lib/mail";
import { AttachmentList } from "@/components/mail/AttachmentList";
import { MessageActionBar } from "@/components/mail/MessageActionBar";
import { MessageHeaderActions } from "@/components/mail/MessageHeaderActions";
import type { Folder } from "@/components/mail/SidebarNav";
import { Button } from "@/components/ui/button";

type Props = {
  mail: Mail | undefined;
  folder: Folder;
  pending?: boolean;
  onMarkRead: (read: boolean) => void;
  onTrash: () => void;
  onRestore?: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onMoveInbox: () => void;
  onStar: (starred: boolean) => void;
  onLabels: () => void;
  onExport: () => void;
  onPrint: () => void;
  onViewDetails: () => void;
  onViewHeaders: () => void;
  onReportPhishing: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
};

export function MessageReader({
  mail,
  folder,
  pending = false,
  onMarkRead,
  onTrash,
  onRestore,
  onArchive,
  onSpam,
  onMoveInbox,
  onStar,
  onLabels,
  onExport,
  onPrint,
  onViewDetails,
  onViewHeaders,
  onReportPhishing,
  onReply,
  onReplyAll,
  onForward,
}: Props) {
  const [htmlView, setHtmlView] = useState(false);

  useEffect(() => {
    if (!mail) return;
    setHtmlView(hasHtmlBody(mail));
  }, [mail?.seq, mail?.htmlBody, mail?.body]);

  if (!mail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white text-muted-foreground">
        Select a message
      </div>
    );
  }

  const htmlAvailable = hasHtmlBody(mail);
  const htmlContent = getHtmlForView(mail);

  return (
    <div className="message-reader flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <MessageActionBar
        mail={mail}
        folder={folder}
        pending={pending}
        htmlView={htmlView}
        onMarkRead={onMarkRead}
        onTrash={onTrash}
        onRestore={onRestore}
        onArchive={onArchive}
        onSpam={onSpam}
        onMoveInbox={onMoveInbox}
        onStar={onStar}
        onLabels={onLabels}
        onExport={onExport}
        onPrint={onPrint}
        onViewDetails={onViewDetails}
        onViewHeaders={onViewHeaders}
        onViewHtml={() => setHtmlView((v) => !v)}
        onReportPhishing={onReportPhishing}
      />
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-foreground">{mail.subject || "(no subject)"}</h2>
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">From </span>
                <span className="font-medium">{mail.from}</span>
              </p>
              {mail.to ? (
                <p>
                  <span className="text-muted-foreground">To </span>
                  <span className="font-medium">{mail.to}</span>
                </p>
              ) : null}
            </div>
          </div>
          <MessageHeaderActions
            mail={mail}
            onStar={onStar}
            onMarkRead={onMarkRead}
            onReply={onReply}
            onReplyAll={onReplyAll}
            onForward={onForward}
          />
        </div>
        <AttachmentList attachments={mail.attachments} />
      </div>
      {htmlAvailable ? (
        <div className="flex shrink-0 gap-2 border-b border-border px-6 py-2">
          <Button
            type="button"
            variant={htmlView ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setHtmlView(true)}
          >
            HTML
          </Button>
          <Button
            type="button"
            variant={!htmlView ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setHtmlView(false)}
          >
            Plain text
          </Button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 bg-white">
        {htmlView && htmlAvailable && htmlContent ? (
          <iframe
            title="HTML message"
            sandbox="allow-same-origin allow-popups"
            srcDoc={wrapHtmlForView(htmlContent)}
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="absolute inset-0 overflow-auto px-6 py-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
              {mail.body || "(no plain text body)"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
