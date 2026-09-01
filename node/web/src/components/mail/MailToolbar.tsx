import {
  Archive,
  Clock,
  Flame,
  FolderInput,
  Mail,
  MailOpen,
  MoreHorizontal,
  Tag,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import type { Folder } from "@/components/mail/SidebarNav";

type Props = {
  folder: Folder;
  allSelected: boolean;
  someSelected: boolean;
  pending?: boolean;
  onSelectAll: (checked: boolean) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onTrash: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onMoveInbox: () => void;
  onLabels: () => void;
  onSnooze: (until: number) => void;
  onDeleteAll?: () => void;
};

export function MailToolbar({
  folder,
  allSelected,
  someSelected,
  pending = false,
  onSelectAll,
  onMarkRead,
  onMarkUnread,
  onTrash,
  onArchive,
  onSpam,
  onMoveInbox,
  onLabels,
  onSnooze,
  onDeleteAll,
}: Props) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const inTrash = folder === "trash";

  const snoozePresets: { key: MessageKey; until: () => number }[] = [
    { key: "toolbar.snooze1h", until: () => Math.floor(Date.now() / 1000) + 3600 },
    {
      key: "toolbar.snoozeTonight",
      until: () => {
        const d = new Date();
        d.setHours(20, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return Math.floor(d.getTime() / 1000);
      },
    },
    {
      key: "toolbar.snoozeTomorrow",
      until: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        return Math.floor(d.getTime() / 1000);
      },
    },
  ];

  return (
    <div className="hidden items-center gap-1 border-b border-border bg-white px-3 py-2 md:flex">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected && !allSelected;
        }}
        disabled={pending}
        onChange={(e) => onSelectAll(e.target.checked)}
        aria-label={t("toolbar.selectAll")}
      />
      <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.markRead")} onClick={onMarkRead}>
        <MailOpen className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.markUnread")} onClick={onMarkUnread}>
        <Mail className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon
        disabled={pending || !someSelected}
        title={inTrash ? t("toolbar.deletePermanently") : t("toolbar.moveToTrash")}
        onClick={onTrash}
      >
        <Trash2 className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.archive")} onClick={onArchive}>
        <Archive className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.moveToSpam")} onClick={onSpam}>
        <Flame className="h-4 w-4" />
      </ToolbarIcon>
      {!inTrash ? (
        <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.moveToInbox")} onClick={onMoveInbox}>
          <FolderInput className="h-4 w-4" />
        </ToolbarIcon>
      ) : null}
      <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.labels")} onClick={onLabels}>
        <Tag className="h-4 w-4" />
      </ToolbarIcon>
      <div className="group relative">
        <ToolbarIcon disabled={pending || !someSelected} title={t("toolbar.snooze")}>
          <Clock className="h-4 w-4" />
        </ToolbarIcon>
        <div className="absolute start-0 top-full z-20 hidden min-w-[140px] rounded-md border border-border bg-white py-1 shadow-lg group-hover:block group-focus-within:block">
          {snoozePresets.map((p) => (
            <button
              key={p.key}
              type="button"
              className="block w-full px-3 py-1.5 text-start text-sm hover:bg-muted disabled:opacity-50"
              disabled={pending || !someSelected}
              onClick={() => onSnooze(p.until())}
            >
              {t(p.key)}
            </button>
          ))}
        </div>
      </div>
      {inTrash && onDeleteAll ? (
        <div className="relative">
          <ToolbarIcon disabled={pending} title={t("toolbar.more")} onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal className="h-4 w-4" />
          </ToolbarIcon>
          {menuOpen ? (
            <>
              <button type="button" className="fixed inset-0 z-10" aria-label={t("aria.closeMenu")} onClick={() => setMenuOpen(false)} />
              <div className="absolute end-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-border bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-destructive hover:bg-muted"
                  onClick={() => {
                    onDeleteAll();
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("toolbar.deleteAll")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
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
