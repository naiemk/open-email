import { Forward, Mail, MailOpen, Reply, ReplyAll, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Mail as MailType } from "@/lib/mail";
import { formatMailWeekday } from "@/lib/mail";
import { useI18n, useT } from "@/i18n/I18nProvider";

type Props = {
  mail: MailType;
  onStar: (starred: boolean) => void;
  onMarkRead: (read: boolean) => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
};

export function MessageHeaderActions({ mail, onStar, onMarkRead, onReply, onReplyAll, onForward }: Props) {
  const t = useT();
  const { intlLocale } = useI18n();
  const unread = mail.direction === "in" && !mail.read;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-8 p-0"
          title={mail.starred ? t("toolbar.unstar") : t("toolbar.star")}
          onClick={() => onStar(!mail.starred)}
        >
          <Star className={`h-4 w-4 ${mail.starred ? "fill-amber-400 text-amber-400" : ""}`} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-8 p-0"
          title={unread ? t("toolbar.markRead") : t("toolbar.markUnread")}
          onClick={() => onMarkRead(unread)}
        >
          {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </Button>
        <span>{formatMailWeekday(mail.time, intlLocale)}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="h-8 w-8 p-0" title={t("compose.reply")} onClick={onReply}>
          <Reply className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" className="h-8 w-8 p-0" title={t("compose.replyAll")} onClick={onReplyAll}>
          <ReplyAll className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" className="h-8 w-8 p-0" title={t("compose.forward")} onClick={onForward}>
          <Forward className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
