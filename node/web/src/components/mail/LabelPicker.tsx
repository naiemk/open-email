import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  labels: string[];
  selected: string[];
  onClose: () => void;
  onApply: (labels: string[]) => void;
};

export function LabelPicker({ open, labels, selected, onClose, onApply }: Props) {
  const [draft, setDraft] = useState(selected);
  const [newLabel, setNewLabel] = useState("");
  if (!open) return null;

  const toggle = (label: string) => {
    setDraft((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-white p-5 shadow-xl">
        <h3 className="font-semibold">Labels</h3>
        <div className="mt-3 max-h-48 space-y-1 overflow-auto">
          {labels.length === 0 ? <p className="text-sm text-muted-foreground">No labels yet.</p> : null}
          {labels.map((label) => (
            <label key={label} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.includes(label)} onChange={() => toggle(label)} />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New label"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLabel.trim()) {
                toggle(newLabel.trim());
                setNewLabel("");
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!newLabel.trim()) return;
              toggle(newLabel.trim());
              setNewLabel("");
            }}
          >
            Add
          </Button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => onApply(draft)}>Apply</Button>
        </div>
      </div>
    </div>
  );
}
