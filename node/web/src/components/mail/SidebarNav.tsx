import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import type { Mail } from "@/lib/mail";

type Folder = "inbox" | "sent" | "trash";

type Props = {
  domain: string;
  folder: Folder;
  counts: Record<Folder, number>;
  storagePct: number;
  onFolder: (f: Folder) => void;
  onCompose: () => void;
  onSettings: () => void;
  onFullSettings: () => void;
};

export function SidebarNav({
  domain,
  folder,
  counts,
  storagePct,
  onFolder,
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
      {(["inbox", "sent", "trash"] as const).map((f) => (
        <button
          key={f}
          type="button"
          className={`mb-0.5 flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm capitalize ${
            folder === f ? "bg-primary text-white" : "hover:bg-white/10"
          }`}
          onClick={() => onFolder(f)}
        >
          <span>{f}</span>
          {counts[f] > 0 ? (
            <span className={`rounded-full px-2 py-0.5 text-xs ${folder === f ? "bg-white/20" : "bg-primary/30"}`}>
              {counts[f]}
            </span>
          ) : null}
        </button>
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

export type { Folder };
