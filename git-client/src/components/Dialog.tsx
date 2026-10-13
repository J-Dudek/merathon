import { useEffect, useState } from "react";
import { useUiStore } from "../store/useUiStore";
import { Button, Modal, inputClass } from "./Modal";

/** Rend la boîte de dialogue demandée via `useUiStore.ask()`. */
export function Dialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setValue(dialog?.input?.initial ?? "");
    setChecked(dialog?.checkbox?.initial ?? false);
  }, [dialog]);

  if (!dialog) return null;

  const needsValue = !!dialog.input && !dialog.input.multiline;
  const canConfirm = !needsValue || value.trim().length > 0;
  const confirm = () => canConfirm && closeDialog({ value, checked });

  return (
    <Modal title={dialog.title} onClose={() => closeDialog(null)}>
      <form
        className="p-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        {dialog.message && <p className="text-xs text-[var(--color-muted)] whitespace-pre-line">{dialog.message}</p>}
        {dialog.sections && dialog.sections.length > 0 && (
          <div className="max-h-64 overflow-y-auto flex flex-col gap-2 rounded border border-overlay/10 bg-shade/20 p-3">
            {dialog.sections.map((section) => (
              <section key={section.title}>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] mb-1">{section.title}</h3>
                <ul className="list-disc pl-4 flex flex-col gap-0.5">
                  {section.items.map((item, i) => (
                    <li key={i} className="text-xs text-[var(--color-text)]">{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {dialog.input && (dialog.input.multiline ? (
          <textarea
            autoFocus
            rows={4}
            className={`${inputClass} resize-none`}
            placeholder={dialog.input.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            autoFocus
            className={inputClass}
            type={dialog.input.secret ? "password" : "text"}
            autoComplete={dialog.input.secret ? "off" : undefined}
            placeholder={dialog.input.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ))}
        {dialog.checkbox && (
          <label className="flex items-center gap-2 text-xs text-[var(--color-text)] cursor-pointer">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {dialog.checkbox.label}
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={() => closeDialog(null)}>Annuler</Button>
          <Button type="submit" variant={dialog.danger ? "danger" : "primary"} disabled={!canConfirm}>
            {dialog.confirmLabel ?? "OK"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
