import { useEffect, useId, useRef, useState } from "preact/hooks";
import { useWorkbench } from "../hooks/useWorkbench";
import type { CopyKey } from "../i18n";
import type { Locale, ProviderProfile } from "../types";
import { t } from "./ui";

interface ProviderEditorProps {
  locale: Locale;
  editing?: ProviderProfile | null;
  onClose: () => void;
}

type FieldKind = "text" | "select" | "textarea";
interface FieldDef {
  name: string;
  labelKey: CopyKey;
  kind: FieldKind;
  options?: Array<{ value: string; labelKey: CopyKey }>;
  placeholderKey?: CopyKey;
}

const KIND_OPTIONS: Array<{ value: string; labelKey: CopyKey }> = [
  { value: "anthropic-compatible", labelKey: "providerKindAnthropic" },
  { value: "openai-proxy", labelKey: "providerKindOpenaiProxy" },
];

const FIELDS: FieldDef[] = [
  { name: "name", labelKey: "providerName", kind: "text", placeholderKey: "providerNamePlaceholder" },
  { name: "kind", labelKey: "providerKind", kind: "select", options: KIND_OPTIONS },
  { name: "baseUrl", labelKey: "providerBaseUrl", kind: "text", placeholderKey: "providerBaseUrlPlaceholder" },
  { name: "apiFormat", labelKey: "providerApiFormat", kind: "text", placeholderKey: "providerApiFormatPlaceholder" },
  { name: "primaryModel", labelKey: "providerPrimaryModel", kind: "text", placeholderKey: "providerModelPlaceholder" },
  { name: "thinkingModel", labelKey: "providerThinkingModel", kind: "text", placeholderKey: "providerModelPlaceholder" },
  { name: "defaultHaikuModel", labelKey: "providerHaiku", kind: "text", placeholderKey: "providerModelPlaceholder" },
  { name: "defaultSonnetModel", labelKey: "providerSonnet", kind: "text", placeholderKey: "providerModelPlaceholder" },
  { name: "defaultOpusModel", labelKey: "providerOpus", kind: "text", placeholderKey: "providerModelPlaceholder" },
  { name: "notes", labelKey: "providerNotes", kind: "textarea", placeholderKey: "providerNotesPlaceholder" },
];

export function ProviderEditor({ locale, editing, onClose }: ProviderEditorProps) {
  const { saveProviderProfile, deleteProviderProfile, setNotice } = useWorkbench();
  const isEditing = Boolean(editing);
  // Backfill every editable field from the profile being edited. Previously
  // baseUrl / thinkingModel / default*Model / notes were hardcoded to "", so
  // opening a saved provider showed them blank and saving overwrote the stored
  // values with undefined — silent data loss. The API returns these fields.
  const [form, setForm] = useState<Record<string, string>>({
    name: editing?.name ?? "",
    kind: editing?.kind ?? "openai-proxy",
    baseUrl: editing?.baseUrl ?? "",
    apiFormat: editing?.apiFormat ?? "",
    primaryModel: editing?.primaryModel ?? "",
    thinkingModel: editing?.thinkingModel ?? "",
    defaultHaikuModel: editing?.defaultHaikuModel ?? "",
    defaultSonnetModel: editing?.defaultSonnetModel ?? "",
    defaultOpusModel: editing?.defaultOpusModel ?? "",
    notes: editing?.notes ?? "",
  });
  const [secret, setSecret] = useState("");
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Dialog behavior: focus first field on open, trap Tab within the dialog,
  // close on Escape, and restore focus to the previously-focused element.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab" || !node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    node?.addEventListener("keydown", onKeyDown);
    return () => { node?.removeEventListener("keydown", onKeyDown); previous?.focus?.(); };
  }, [onClose]);

  const nonOfficialBaseUrl = form.baseUrl.trim() !== "" && form.kind !== "official";

  const update = (name: string, value: string) => setForm((prev) => ({ ...prev, [name]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      setNotice({ kind: "warning", message: t(locale, "providerNameRequired") });
      return;
    }
    if (!form.apiFormat.trim()) {
      setNotice({ kind: "warning", message: t(locale, "providerApiFormatRequired") });
      return;
    }
    if (nonOfficialBaseUrl && !confirmRisk) {
      setNotice({ kind: "warning", message: t(locale, "providerConfirmBaseUrlRequired") });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        kind: form.kind,
        apiFormat: form.apiFormat.trim(),
        primaryModel: form.primaryModel.trim() || undefined,
        thinkingModel: form.thinkingModel.trim() || undefined,
        defaultHaikuModel: form.defaultHaikuModel.trim() || undefined,
        defaultSonnetModel: form.defaultSonnetModel.trim() || undefined,
        defaultOpusModel: form.defaultOpusModel.trim() || undefined,
        notes: form.notes.trim() || undefined,
        baseUrl: form.baseUrl.trim() || undefined,
        _confirmBaseUrlRisk: nonOfficialBaseUrl ? true : undefined,
      };
      if (editing?.id) payload.id = editing.id;
      if (secret.trim()) payload.secret = secret.trim();
      await saveProviderProfile(payload);
      setNotice({ kind: "success", message: isEditing ? t(locale, "providerUpdated") : t(locale, "providerCreated") });
      onClose();
    } catch (error) {
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editing?.id) return;
    setBusy(true);
    try {
      await deleteProviderProfile(editing.id);
      setNotice({ kind: "success", message: t(locale, "providerDeleted") });
      onClose();
    } catch (error) {
      setNotice({ kind: "danger", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="provider-editor" data-provider-editor="true" role="dialog" aria-modal="true" aria-labelledby={headingId} ref={dialogRef}>
      <div class="provider-editor-head">
        <strong id={headingId}>{isEditing ? t(locale, "providerEdit") : t(locale, "providerAdd")}</strong>
        <button type="button" class="icon-button" onClick={onClose} aria-label={t(locale, "providerCancel")}><span aria-hidden="true">×</span></button>
      </div>

      <div class="provider-editor-body">
        {FIELDS.map((field) => (
          <label class="field" key={field.name} htmlFor={field.name}>
            <span>{t(locale, field.labelKey)}</span>
            {field.kind === "select"
              ? <select id={field.name} value={form[field.name]} onChange={(e) => update(field.name, (e.currentTarget as HTMLSelectElement).value)}>
                  {field.options?.map((option) => <option value={option.value}>{t(locale, option.labelKey)}</option>)}
                </select>
              : field.kind === "textarea"
                ? <textarea id={field.name} value={form[field.name]} placeholder={field.placeholderKey ? t(locale, field.placeholderKey) : ""} onInput={(e) => update(field.name, (e.currentTarget as HTMLTextAreaElement).value)} rows={2}/>
                : <input id={field.name} type="text" value={form[field.name]} placeholder={field.placeholderKey ? t(locale, field.placeholderKey) : ""} onInput={(e) => update(field.name, (e.currentTarget as HTMLInputElement).value)} />}
          </label>
        ))}

        <label class="field">
          <span>{t(locale, "providerSecret")}</span>
          <input type="password" value={secret} placeholder={isEditing ? t(locale, "providerSecretPlaceholderEdit") : t(locale, "providerSecretPlaceholder")} onInput={(e) => setSecret((e.currentTarget as HTMLInputElement).value)} />
        </label>

        {nonOfficialBaseUrl && (
          <label class="field-check">
            <input type="checkbox" checked={confirmRisk} onInput={(e) => setConfirmRisk((e.currentTarget as HTMLInputElement).checked)} />
            <span>{t(locale, "providerConfirmBaseUrlRisk")}</span>
          </label>
        )}
      </div>

      <div class="provider-editor-actions">
        {isEditing && !editing?.isBuiltIn && (
          <button type="button" class="button danger" onClick={handleDelete} disabled={busy}>{t(locale, "providerDelete")}</button>
        )}
        <span class="spacer" />
        <button type="button" class="button ghost" onClick={onClose} disabled={busy}>{t(locale, "providerCancel")}</button>
        <button type="button" class="button primary" onClick={handleSave} disabled={busy}>{t(locale, "providerSave")}</button>
      </div>
    </div>
  );
}
