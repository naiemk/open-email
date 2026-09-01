import { useEffect, useState } from "react";
import { Forward, Reply, ReplyAll, Star } from "lucide-react";
import { ActionSheet } from "@/components/mobile/ActionSheet";
import { MobileReaderHeader } from "@/components/mobile/MobileReaderHeader";
import type { Mail } from "@/lib/mail";
import { formatMailWeekday, getHtmlForView, hasHtmlBody, wrapHtmlForView } from "@/lib/mail";
import { AttachmentList } from "@/components/mail/AttachmentList";
import { buildMoreMenuItems, MessageActionBar } from "@/components/mail/MessageActionBar";
import { MessageHeaderActions } from "@/components/mail/MessageHeaderActions";
import type { Folder } from "@/components/mail/SidebarNav";
import { Button } from "@/components/ui/button";

type Props = {
  mail: Mail | undefined;
  folder: Folder;
  pending?: boolean;
  onBack?: () => void;
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
  onBack,
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
  const [moreOpen, setMoreOpen] = useState(false);

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
  const unread = mail.direction === "in" && !mail.read;

  const actionBarProps = {
    mail,
    folder,
    pending,
    htmlView,
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
    onViewHtml: () => setHtmlView((v) => !v),
    onReportPhishing,
  };

  return (
    <div className="message-reader flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      {onBack ? (
        <MobileReaderHeader
          folder={folder}
          unread={unread}
          pending={pending}
          onBack={onBack}
          onMarkRead={onMarkRead}
          onTrash={onTrash}
          onRestore={onRestore}
          onArchive={onArchive}
          onSpam={onSpam}
          onMoveInbox={onMoveInbox}
          onMore={() => setMoreOpen(true)}
        />
      ) : null}
      <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={buildMoreMenuItems(actionBarProps)} />
      <MessageActionBar {...actionBarProps} />
      <div className="hidden shrink-0 border-b border-border px-6 py-4 md:block">
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
      <div className="shrink-0 border-b border-border px-4 py-3 md:hidden">
        <h2 className="text-lg font-semibold leading-snug text-foreground">{mail.subject || "(no subject)"}</h2>
        <div className="mt-3 rounded-xl border border-border bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{mail.from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] || mail.from}</p>
              <p className="truncate text-xs text-primary">{mail.from.replace(/^.*<([^>]+)>/, "").replace(/>.*$/, "") || mail.from}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-muted-foreground">{formatMailWeekday(mail.time)}</span>
              <button type="button" aria-label={mail.starred ? "Unstar" : "Star"} onClick={() => onStar(!mail.starred)}>
                <Star className={`h-4 w-4 ${mail.starred ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
            </div>
          </div>
          {mail.to ? (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              To <span className="text-foreground">{mail.to}</span>
            </p>
          ) : null}
        </div>
        <AttachmentList attachments={mail.attachments} />
        <div className="mt-3 flex items-center justify-end gap-1 rounded-full border border-border bg-muted/30 px-2 py-1">
          <Button type="button" variant="ghost" className="h-9 w-9 p-0" title="Reply" onClick={onReply}>
            <Reply className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" className="h-9 w-9 p-0" title="Reply all" onClick={onReplyAll}>
            <ReplyAll className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" className="h-9 w-9 p-0" title="Forward" onClick={onForward}>
            <Forward className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {htmlAvailable ? (
        <div className="flex shrink-0 gap-2 border-b border-border px-4 py-2 md:px-6">
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
          <div className="absolute inset-0 overflow-auto px-4 py-4 md:px-6">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
              {mail.body || "(no plain text body)"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
