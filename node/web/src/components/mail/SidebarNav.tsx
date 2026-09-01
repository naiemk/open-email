import type { ReactNode } from "react";
import { Archive, Flame, RefreshCw, Star } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";

export type Folder = "inbox" | "sent" | "starred" | "archive" | "spam" | "trash";

type Props = {
  domain: string;
  folder: Folder;
  counts: Record<Folder, number>;
  unreadInbox: number;
  storagePct: number;
  refreshPending?: boolean;
  onFolder: (f: Folder) => void;
  onRefresh: () => void;
  onCompose: () => void;
  onSettings: () => void;
  onFullSettings: () => void;
};

const FOLDERS: { id: Folder; label: string; icon?: ReactNode }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "starred", label: "Starred", icon: <Star className="h-3.5 w-3.5" /> },
  { id: "archive", label: "Archive", icon: <Archive className="h-3.5 w-3.5" /> },
  { id: "spam", label: "Spam", icon: <Flame className="h-3.5 w-3.5" /> },
  { id: "trash", label: "Trash" },
];

export function SidebarNav({
  domain,
  folder,
  counts,
  unreadInbox,
  storagePct,
  refreshPending = false,
  onFolder,
  onRefresh,
  onCompose,
  onSettings,
  onFullSettings,
}: Props) {
  return (
    <nav className="flex h-full w-[220px] shrink-0 flex-col bg-[#1b1330] px-3 py-4 text-[#e9e4ff]">
      <div className="mb-4 flex items-center gap-2 px-2">
        <BrandMark size={24} />
        <span className="text-sm font-bold tracking-wide">{domain}</span>
      </div>
      <Button className="mb-4 w-full justify-center rounded-full bg-primary py-2.5" onClick={onCompose}>
        New message
      </Button>
      {FOLDERS.map(({ id, label, icon }) => (
        <div key={id} className="mb-0.5 flex items-center gap-1">
          <button
            type="button"
            className={`flex flex-1 items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm capitalize ${
              folder === id ? "bg-primary text-white" : "hover:bg-white/10"
            }`}
            onClick={() => onFolder(id)}
          >
            <span className="flex items-center gap-2">
              {icon}
              {label}
            </span>
            {id === "inbox" && unreadInbox > 0 ? (
              <span className={`rounded-full px-2 py-0.5 text-xs ${folder === id ? "bg-white/20" : "bg-primary/30"}`}>
                {unreadInbox}
              </span>
            ) : id !== "inbox" && counts[id] > 0 ? (
              <span className={`rounded-full px-2 py-0.5 text-xs ${folder === id ? "bg-white/20" : "bg-primary/30"}`}>
                {counts[id]}
              </span>
            ) : null}
          </button>
          {id === "inbox" ? (
            <button
              type="button"
              className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-50"
              title="Refresh"
              disabled={refreshPending}
              onClick={onRefresh}
            >
              <RefreshCw className={`h-4 w-4 ${refreshPending ? "animate-spin" : ""}`} />
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="mt-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/10" onClick={onSettings}>
        Quick settings
      </button>
      <button type="button" className="rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/10" onClick={onFullSettings}>
        All settings
      </button>
      <div className="mt-auto px-2 pt-4 text-xs text-[#c4b5fd]">
        <div className="mb-1">Storage {storagePct}%</div>
        <div className="h-1.5 rounded-full bg-white/15">
          <div className="h-full rounded-full bg-primary" style={{ width: `${storagePct}%` }} />
        </div>
      </div>
    </nav>
  );
}
