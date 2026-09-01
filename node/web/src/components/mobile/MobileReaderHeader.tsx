import {
  Archive,
  ArrowLeft,
  Flame,
  Mail,
  MailOpen,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  folder: string;
  unread: boolean;
  pending?: boolean;
  onBack: () => void;
  onMarkRead: (read: boolean) => void;
  onTrash: () => void;
  onRestore?: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onMore: () => void;
};

export function MobileReaderHeader({
  folder,
  unread,
  pending = false,
  onBack,
  onMarkRead,
  onTrash,
  onRestore,
  onArchive,
  onSpam,
  onMore,
}: Props) {
  const t = useT();
  const inTrash = folder === "trash";

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-white px-2 py-1 md:hidden">
      <Button type="button" variant="ghost" className="h-10 w-10 p-0" aria-label={t("aria.back")} onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="flex max-w-[calc(100%-3rem)] items-center gap-0.5 overflow-x-auto">
        <ToolbarIcon
          disabled={pending}
          title={unread ? t("toolbar.markRead") : t("toolbar.markUnread")}
          onClick={() => onMarkRead(unread)}
        >
          {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </ToolbarIcon>
        {inTrash ? (
          <ToolbarIcon disabled={pending} title={t("toolbar.deletePermanently")} onClick={onTrash}>
            <Trash2 className="h-4 w-4" />
          </ToolbarIcon>
        ) : (
          <ToolbarIcon disabled={pending} title={t("toolbar.moveToTrash")} onClick={onTrash}>
            <Trash2 className="h-4 w-4" />
          </ToolbarIcon>
        )}
        <ToolbarIcon disabled={pending} title={t("toolbar.archive")} onClick={onArchive}>
          <Archive className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon disabled={pending} title={t("toolbar.moveToSpam")} onClick={onSpam}>
          <Flame className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon disabled={pending} title={t("toolbar.more")} onClick={onMore}>
          <MoreHorizontal className="h-4 w-4" />
        </ToolbarIcon>
      </div>
    </header>
  );
}

function ToolbarIcon({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button type="button" variant="ghost" className="h-10 w-10 shrink-0 p-0" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </Button>
  );
}
