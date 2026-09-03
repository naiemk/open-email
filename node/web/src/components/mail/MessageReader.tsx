import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { EncryptionLock } from "@/components/mail/EncryptionLock";
import { ActionSheet } from "@/components/mobile/ActionSheet";
import { MobileReaderHeader } from "@/components/mobile/MobileReaderHeader";
import type { Mail } from "@/lib/mail";
import { formatMailWeekday, getHtmlForView, hasHtmlBody, wrapHtmlForView } from "@/lib/mail";
import { AttachmentList } from "@/components/mail/AttachmentList";
import { buildMoreMenuItems, MessageActionBar } from "@/components/mail/MessageActionBar";
import { MessageHeaderMeta } from "@/components/mail/MessageHeaderMeta";
import { MessageLocalToolbar } from "@/components/mail/MessageLocalToolbar";
import type { Folder } from "@/components/mail/SidebarNav";
import { useI18n, useT } from "@/i18n/I18nProvider";

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
  onDeleteAll?: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
};

function HtmlMessageBody({ html, title }: { html: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);

  const resize = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const h = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 320;
    setHeight(Math.max(h, 120));
  };

  useEffect(() => {
    setHeight(320);
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox="allow-same-origin allow-popups"
      srcDoc={wrapHtmlForView(html)}
      className="w-full border-0 bg-white"
      style={{ height }}
      onLoad={resize}
    />
  );
}

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
  onDeleteAll,
  onReply,
  onReplyAll,
  onForward,
}: Props) {
  const t = useT();
  const { intlLocale } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!mail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white text-muted-foreground">
        {t("mail.selectMessage")}
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
    onDeleteAll,
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
          onMore={() => setMoreOpen(true)}
        />
      ) : null}
      <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={buildMoreMenuItems(actionBarProps, t)} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="flex items-start gap-2 px-4 pt-4 text-xl font-semibold text-foreground md:px-6 md:pt-6">
          <EncryptionLock e2ee={Boolean(mail.openPgpEncrypted)} className="mt-1 h-5 w-5" />
          <span className="min-w-0 flex-1">{mail.subject || t("mail.noSubject")}</span>
        </h2>

        <div className="hidden px-6 py-3 md:block">
          <div className="flex items-start justify-between gap-4 text-sm">
            <p className="min-w-0">
              <span className="text-muted-foreground">{t("mail.from")} </span>
              <span className="font-medium">{mail.from}</span>
            </p>
            <MessageHeaderMeta mail={mail} onStar={onStar} onMarkRead={onMarkRead} />
          </div>
          {mail.to ? (
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">{t("mail.to")} </span>
              <span className="font-medium">{mail.to}</span>
            </p>
          ) : null}
          <AttachmentList attachments={mail.attachments} />
        </div>

        <div className="px-4 py-3 md:hidden">
          <div className="rounded-xl border border-border bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {mail.from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] || mail.from}
                </p>
                <p className="truncate text-xs text-primary">
                  {mail.from.replace(/^.*<([^>]+)>/, "").replace(/>.*$/, "") || mail.from}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">{formatMailWeekday(mail.time, intlLocale)}</span>
                <button
                  type="button"
                  aria-label={mail.starred ? t("toolbar.unstar") : t("toolbar.star")}
                  onClick={() => onStar(!mail.starred)}
                >
                  <Star className={`h-4 w-4 ${mail.starred ? "fill-amber-400 text-amber-400" : ""}`} />
                </button>
              </div>
            </div>
            {mail.to ? (
              <p className="mt-2 truncate text-xs text-muted-foreground">
                {t("mail.to")} <span className="text-foreground">{mail.to}</span>
              </p>
            ) : null}
          </div>
          <AttachmentList attachments={mail.attachments} />
        </div>

        <div className="hidden items-center justify-between gap-2 border-b border-border px-4 py-2 md:flex md:px-6">
          <MessageActionBar {...actionBarProps} inline />
          <MessageLocalToolbar onReply={onReply} onReplyAll={onReplyAll} onForward={onForward} />
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 md:hidden">
          <div className="flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-1">
            <MessageLocalToolbar onReply={onReply} onReplyAll={onReplyAll} onForward={onForward} />
          </div>
        </div>

        <div className="px-4 py-4 md:px-6">
          {htmlAvailable && htmlContent ? (
            <HtmlMessageBody html={htmlContent} title={t("mail.htmlMessage")} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
              {mail.body || "(no plain text body)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
