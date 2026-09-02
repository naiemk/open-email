import {
  Archive,
  Download,
  FileText,
  Flame,
  Filter,
  FolderInput,
  Mail,
  MailOpen,
  MoreHorizontal,
  Printer,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { ActionSheet, type ActionSheetItem } from "@/components/mobile/ActionSheet";
import { Button } from "@/components/ui/button";
import type { Mail as MailType } from "@/lib/mail";
import { hasHtmlBody } from "@/lib/mail";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";

type Props = {
  mail: MailType;
  folder: string;
  pending?: boolean;
  htmlView?: boolean;
  inline?: boolean;
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
  onViewHtml: () => void;
  onReportPhishing: () => void;
  onDeleteAll?: () => void;
};

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function buildMoreMenuItems(props: Props, t: TFn): ActionSheetItem[] {
  const {
    folder,
    mail,
    htmlView,
    onStar,
    onArchive,
    onSpam,
    onExport,
    onPrint,
    onViewDetails,
    onViewHeaders,
    onViewHtml,
    onReportPhishing,
    onDeleteAll,
    onRestore,
    onMoveInbox,
  } = props;
  const items: ActionSheetItem[] = [];

  if (folder === "trash" && onDeleteAll) {
    items.push({
      label: t("toolbar.deleteAll"),
      icon: <Trash2 className="h-4 w-4" />,
      className: "text-destructive",
      onClick: onDeleteAll,
    });
  }

  if (folder === "trash") {
    items.push({
      label: t("toolbar.restore"),
      icon: <FolderInput className="h-4 w-4" />,
      onClick: () => onRestore?.(),
    });
    items.push({
      label: t("toolbar.moveToInbox"),
      icon: <FolderInput className="h-4 w-4" />,
      onClick: onMoveInbox,
    });
  }

  items.push(
    {
      label: mail.starred ? t("toolbar.unstar") : t("toolbar.star"),
      icon: <Star className="h-4 w-4" />,
      onClick: () => onStar(!mail.starred),
    },
    { label: t("toolbar.archive"), icon: <Archive className="h-4 w-4" />, onClick: onArchive },
    { label: t("toolbar.moveToSpam"), icon: <Flame className="h-4 w-4" />, onClick: onSpam },
    { label: t("toolbar.export"), icon: <Download className="h-4 w-4" />, onClick: onExport },
    { label: t("toolbar.print"), icon: <Printer className="h-4 w-4" />, onClick: onPrint },
    { label: t("toolbar.viewDetails"), icon: <FileText className="h-4 w-4" />, onClick: onViewDetails },
    { label: t("toolbar.viewHeaders"), icon: <FileText className="h-4 w-4" />, onClick: onViewHeaders },
  );

  if (hasHtmlBody(mail)) {
    items.push({
      label: htmlView ? t("toolbar.viewPlainText") : t("toolbar.viewHtml"),
      icon: <FileText className="h-4 w-4" />,
      onClick: onViewHtml,
    });
  }
  items.push({
    label: t("toolbar.reportPhishing"),
    className: "text-destructive",
    onClick: onReportPhishing,
  });
  return items;
}

export function MessageActionBar(props: Props) {
  const t = useT();
  const {
    mail,
    folder,
    pending = false,
    inline = false,
    onMarkRead,
    onTrash,
    onRestore,
    onArchive,
    onMoveInbox,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = mail.direction === "in" && !mail.read;
  const menuItems = buildMoreMenuItems(props, t);
  const inTrash = folder === "trash";

  return (
    <div className={inline ? "flex items-center gap-1" : "hidden items-center gap-1 border-b border-border px-4 py-2 md:flex"}>
      <ToolbarIcon disabled={pending} title={unread ? t("toolbar.markRead") : t("toolbar.markUnread")} onClick={() => onMarkRead(unread)}>
        {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
      </ToolbarIcon>
      {inTrash ? (
        <>
          <ToolbarIcon disabled={pending} title={t("toolbar.restore")} onClick={onRestore}>
            <FolderInput className="h-4 w-4" />
          </ToolbarIcon>
          <ToolbarIcon disabled={pending} title={t("toolbar.deletePermanently")} onClick={onTrash}>
            <Trash2 className="h-4 w-4" />
          </ToolbarIcon>
        </>
      ) : (
        <ToolbarIcon disabled={pending} title={t("toolbar.moveToTrash")} onClick={onTrash}>
          <Trash2 className="h-4 w-4" />
        </ToolbarIcon>
      )}
      <ToolbarIcon disabled={pending} title={t("toolbar.archive")} onClick={onArchive}>
        <Archive className="h-4 w-4" />
      </ToolbarIcon>
      {!inTrash ? (
        <ToolbarIcon disabled={pending} title={t("toolbar.moveToInbox")} onClick={onMoveInbox}>
          <FolderInput className="h-4 w-4" />
        </ToolbarIcon>
      ) : null}
      <ToolbarIcon disabled={pending} title={t("toolbar.labels")} onClick={props.onLabels}>
        <Tag className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled title={t("toolbar.filterComingSoon")}>
        <Filter className="h-4 w-4 opacity-40" />
      </ToolbarIcon>
      <div className="relative">
        <ToolbarIcon disabled={pending} title={t("toolbar.more")} onClick={() => setMenuOpen((v) => !v)}>
          <MoreHorizontal className="h-4 w-4" />
        </ToolbarIcon>
        {menuOpen ? (
          <>
            <button type="button" className="fixed inset-0 z-10" aria-label={t("aria.closeMenu")} onClick={() => setMenuOpen(false)} />
            <div className="absolute end-0 top-full z-20 mt-1 min-w-[220px] rounded-md border border-border bg-white py-1 shadow-lg">
              {menuItems.map((item) => (
                <MenuItem
                  key={item.label}
                  icon={item.icon}
                  className={item.className}
                  onClick={() => {
                    item.onClick();
                    setMenuOpen(false);
                  }}
                >
                  {item.label}
                </MenuItem>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ToolbarIcon({
  children,
  title,
  disabled,
  onClick,
}: {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button type="button" variant="ghost" className="h-8 w-8 p-0" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </Button>
  );
}

function MenuItem({
  children,
  icon,
  className = "",
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted ${className}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
