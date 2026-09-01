import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  optedIn: boolean;
  storage: { total_size: number; cap: number };
  optPending?: boolean;
  onClose: () => void;
  onOptToggle: () => void;
  onAddDevice: () => void;
  onFullSettings: () => void;
  onLogout: () => void;
};

export function SettingsDrawer({
  open,
  optedIn,
  storage,
  optPending = false,
  onClose,
  onOptToggle,
  onAddDevice,
  onFullSettings,
  onLogout,
}: Props) {
  if (!open) return null;

  const pct = storage.cap ? Math.round((storage.total_size / storage.cap) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-[360px] flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">Settings</h2>
          <button type="button" className="text-xl" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          <Button className="w-full" onClick={onFullSettings}>
            All settings
          </Button>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">Receiving mail</p>
            <p className="mt-1 text-muted-foreground">
              Opted in: <strong>{optedIn ? "yes" : "no"}</strong>
            </p>
            <Button variant="outline" className="mt-3 w-full" disabled={optPending} onClick={onOptToggle}>
              {optPending ? "Working…" : optedIn ? "Opt out of this node" : "Opt in to this node"}
            </Button>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">Devices</p>
            <Button variant="outline" className="mt-3 w-full" onClick={onAddDevice}>
              Add another device (QR)
            </Button>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">Storage</p>
            <p className="mt-1 text-muted-foreground">
              {storage.total_size.toLocaleString()} / {storage.cap.toLocaleString()} bytes ({pct}%)
            </p>
          </div>
          <Button variant="ghost" className="w-full" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </aside>
    </div>
  );
}
