import { useState } from "react";
import type { Mail } from "@/lib/mail";
import { AttachmentList } from "@/components/mail/AttachmentList";
import { MessageActionBar } from "@/components/mail/MessageActionBar";
import { MessageHeaderActions } from "@/components/mail/MessageHeaderActions";
import type { Folder } from "@/components/mail/SidebarNav";

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
  if (!mail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white text-muted-foreground">
        Select a message
      </div>
    );
  }

  return (
    <div className="message-reader flex flex-1 flex-col overflow-hidden bg-white">
      <MessageActionBar
        mail={mail}
        folder={folder}
        pending={pending}
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
      <div className="border-b border-border px-6 py-4">
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
      <div className="flex-1 overflow-auto px-6 py-4">
        {htmlView && mail.htmlBody ? (
          <iframe title="HTML message" sandbox="" srcDoc={mail.htmlBody} className="min-h-[320px] w-full rounded-md border border-border" />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{mail.body}</pre>
        )}
      </div>
    </div>
  );
}
