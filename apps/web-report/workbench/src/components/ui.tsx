import { type ComponentChildren, cloneElement, isValidElement, type VNode } from "preact";
import { useId } from "preact/hooks";
import type { CopyKey } from "../i18n";
import { copy } from "../i18n";
import type { CostQuality, Locale } from "../types";

export type IconName = "runs" | "plus" | "compare" | "library" | "environment" | "settings" | "plan" | "live" | "outcome" | "evidence" | "check" | "warning" | "danger" | "info" | "refresh" | "cancel" | "upload" | "clock" | "repo" | "agent" | "trace" | "file" | "cost" | "menu" | "chevron" | "external";

const paths: Record<IconName, ComponentChildren> = {
  runs: <><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  compare: <><path d="M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4"/></>,
  library: <><path d="M4 5h5v14H4zM10 5h5v14h-5zM16 5h4v14h-4z"/></>,
  environment: <><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6-.7-2h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4z"/></>,
  plan: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  live: <><circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></>,
  outcome: <><path d="M4 20V10M10 20V4M16 20v-7M3 20h18"/></>,
  evidence: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8M8 15h6"/></>,
  check: <path d="m5 12 4 4L19 6"/>, warning: <><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4M12 17h.01"/></>,
  danger: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>, info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M18.5 15a8 8 0 1 1 .5-7l1 4"/></>, cancel: <><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v6h14v-6"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  repo: <><path d="M4 4h6l2 3h8v13H4z"/></>, agent: <><rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 3v4M9 12h.01M15 12h.01M9 15h6"/></>,
  trace: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h4a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3"/></>, file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/></>,
  cost: <><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1.2 1.8 3 2.2 3 1 3 2.3-1.3 2.5-3 2.5c-1.3 0-2.5-.4-3.2-1.2M12 5v14"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>, chevron: <path d="m9 6 6 6-6 6"/>, external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function StatusPill({ tone = "neutral", children }: { tone?: "success" | "warning" | "danger" | "info" | "neutral"; children: ComponentChildren }) {
  const icon = tone === "success" ? "check" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : tone === "info" ? "info" : null;
  return <span class={`status-pill status-${tone}`}>{icon && <Icon name={icon}/>}<span>{children}</span></span>;
}

export function Notice({ kind, children, onClose, closeLabel = "Dismiss" }: { kind: "info" | "success" | "warning" | "danger"; children: ComponentChildren; onClose?: () => void; closeLabel?: string }) {
  return <div class={`notice notice-${kind}`} role={kind === "danger" ? "alert" : "status"}>
    <Icon name={kind === "success" ? "check" : kind}/><div class="notice-body">{children}</div>
    {onClose && <button class="icon-button" type="button" onClick={onClose} aria-label={closeLabel}><Icon name="cancel"/></button>}
  </div>;
}

/** Loading placeholder that is announced to assistive tech (role=status + aria-busy).
 *  Callers pass a localized `label` so screen readers hear "Loading" in the active locale. */
export function Skeleton({ lines = 3, large = false, label }: { lines?: number; large?: boolean; label?: string }) {
  return <div class={`skeleton-lines ${large ? "large" : ""}`} role="status" aria-busy="true" aria-label={label ?? "Loading"}>
    {Array.from({ length: lines }, (_, index) => <span key={index}/>)}
  </div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ComponentChildren }) {
  return <header class="page-header"><div><div class="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div class="page-actions">{actions}</div>}</header>;
}

export function Section({ title, description, actions, children, className = "" }: { title?: string; description?: string; actions?: ComponentChildren; children: ComponentChildren; className?: string }) {
  return <section class={`section ${className}`}>
    {(title || actions) && <header class="section-header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div class="section-actions">{actions}</div>}</header>}
    {children}
  </section>;
}

export function EmptyState({ icon = "runs", title, message, actions }: { icon?: IconName; title: string; message: string; actions?: ComponentChildren }) {
  return <div class="empty-state"><div class="empty-icon"><Icon name={icon} size={24}/></div><h2>{title}</h2><p>{message}</p>{actions && <div class="empty-actions">{actions}</div>}</div>;
}

export function Metric({ label, value, meta, icon }: { label: string; value: ComponentChildren; meta?: ComponentChildren; icon?: IconName }) {
  return <div class="metric"><div class="metric-label">{icon && <Icon name={icon}/>}<span>{label}</span></div><div class="metric-value">{value}</div>{meta && <div class="metric-meta">{meta}</div>}</div>;
}

export function Field({ label, help, error, children }: { label: string; help?: string; error?: string; children: ComponentChildren }) {
  const id = useId();
  const messageId = `${id}-message`;
  const control = isValidElement(children)
    ? cloneElement(children as VNode<Record<string, unknown>>, { id, "aria-describedby": error || help ? messageId : undefined })
    : children;
  return <div class={`field ${error ? "field-error" : ""}`}><label class="field-label" for={id}>{label}</label>{control}{error ? <span id={messageId} class="field-message" role="alert">{error}</span> : help ? <span id={messageId} class="field-help">{help}</span> : null}</div>;
}

export function t(locale: Locale, key: CopyKey, params?: Record<string, string | number>): string {
  let text: string = copy[locale][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return text;
}

export function formatDuration(value: number | null, locale: Locale): string {
  if (value === null) return t(locale, "unknown");
  if (value < 1000) return `${value}ms`;
  const seconds = Math.round(value / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function formatCost(value: number | null, locale: Locale, quality: CostQuality = "known"): string { return value === null || quality === "unavailable" ? t(locale, "unknown") : `${quality === "estimated" ? "\u2248" : ""}$${value.toFixed(2)}`; }
export function formatTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return t(locale, "unknown");
  const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

