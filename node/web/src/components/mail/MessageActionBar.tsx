import { useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import type { Mail as MailType } from "@/lib/mail";
import { hasHtmlBody } from "@/lib/mail";

type Props = {
  mail: MailType;
  folder: string;
  pending?: boolean;
  htmlView?: boolean;
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
};

export function MessageActionBar({
  mail,
  folder,
  pending = false,
  htmlView = false,
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
  onViewHtml,
  onReportPhishing,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = mail.direction === "in" && !mail.read;

  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-2">
      <ToolbarIcon disabled={pending} title={unread ? "Mark read" : "Mark unread"} onClick={() => onMarkRead(unread)}>
        {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
      </ToolbarIcon>
      {folder === "trash" ? (
        <ToolbarIcon disabled={pending} title="Restore" onClick={onRestore}>
          <FolderInput className="h-4 w-4" />
        </ToolbarIcon>
      ) : (
        <ToolbarIcon disabled={pending} title="Move to trash" onClick={onTrash}>
          <Trash2 className="h-4 w-4" />
        </ToolbarIcon>
      )}
      <ToolbarIcon disabled={pending} title="Archive" onClick={onArchive}>
        <Archive className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending} title="Move to inbox" onClick={onMoveInbox}>
        <FolderInput className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending} title="Labels" onClick={onLabels}>
        <Tag className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled title="Filter messages like this (coming soon)">
        <Filter className="h-4 w-4 opacity-40" />
      </ToolbarIcon>
      <div className="relative">
        <ToolbarIcon disabled={pending} title="More" onClick={() => setMenuOpen((v) => !v)}>
          <MoreHorizontal className="h-4 w-4" />
        </ToolbarIcon>
        {menuOpen ? (
          <>
            <button type="button" className="fixed inset-0 z-10" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[220px] rounded-md border border-border bg-white py-1 shadow-lg">
              <MenuItem icon={<Star className="h-4 w-4" />} onClick={() => { onStar(!mail.starred); setMenuOpen(false); }}>
                {mail.starred ? "Unstar" : "Star"}
              </MenuItem>
              <MenuItem icon={<Archive className="h-4 w-4" />} onClick={() => { onArchive(); setMenuOpen(false); }}>Archive</MenuItem>
              <MenuItem icon={<Flame className="h-4 w-4" />} onClick={() => { onSpam(); setMenuOpen(false); }}>Move to spam</MenuItem>
              <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => { onExport(); setMenuOpen(false); }}>Export</MenuItem>
              <MenuItem icon={<Printer className="h-4 w-4" />} onClick={() => { onPrint(); setMenuOpen(false); }}>Print</MenuItem>
              <MenuItem icon={<FileText className="h-4 w-4" />} onClick={() => { onViewDetails(); setMenuOpen(false); }}>View message details</MenuItem>
              <MenuItem icon={<FileText className="h-4 w-4" />} onClick={() => { onViewHeaders(); setMenuOpen(false); }}>View headers</MenuItem>
              {hasHtmlBody(mail) ? (
                <MenuItem icon={<FileText className="h-4 w-4" />} onClick={() => { onViewHtml(); setMenuOpen(false); }}>
                  {htmlView ? "View plain text" : "View HTML"}
                </MenuItem>
              ) : null}
              <MenuItem className="text-destructive" onClick={() => { onReportPhishing(); setMenuOpen(false); }}>Report phishing</MenuItem>
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
    <button type="button" className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${className}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
