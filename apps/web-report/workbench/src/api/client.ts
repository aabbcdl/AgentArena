const AUTH_KEY = "agentarena-auth-token";
const BOOTSTRAP_PARAM = "bootstrap";
const LEGACY_TOKEN_PARAM = "token";
let bootstrapInitialization: Promise<void> | undefined;

function authToken(): string {
  try {
    return sessionStorage.getItem(AUTH_KEY) ?? "";
  } catch {
    return "";
  }
}

function takeBootstrapCodeFromHash(): string {
  const rawHash = window.location.hash.replace(/^#/, "");
  const routeSeparator = rawHash.startsWith("/") ? rawHash.indexOf("?") : -1;
  const route = routeSeparator >= 0 ? rawHash.slice(0, routeSeparator) : "";
  const params = new URLSearchParams(routeSeparator >= 0 ? rawHash.slice(routeSeparator + 1) : rawHash);
  const bootstrapCode = params.get(BOOTSTRAP_PARAM) ?? "";
  const hadCredentialParams = params.has(BOOTSTRAP_PARAM) || params.has(LEGACY_TOKEN_PARAM);
  params.delete(BOOTSTRAP_PARAM);
  params.delete(LEGACY_TOKEN_PARAM);

  if (hadCredentialParams) {
    const remaining = params.toString();
    const nextHash = route
      ? `${route}${remaining ? `?${remaining}` : ""}`
      : remaining
        ? `#${remaining}`
        : "";
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }

  return bootstrapCode;
}

export function initializeAuthBootstrap(): Promise<void> {
  if (bootstrapInitialization) return bootstrapInitialization;

  bootstrapInitialization = (async () => {
    const code = takeBootstrapCodeFromHash();
    if (!code) return;

    const response = await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store"
    });
    const data = await response.json().catch(() => null) as { token?: unknown; error?: unknown } | null;
    if (!response.ok || typeof data?.token !== "string" || !data.token) {
      throw new Error(typeof data?.error === "string" ? data.error : "Authentication bootstrap failed.");
    }
    try {
      sessionStorage.setItem(AUTH_KEY, data.token);
    } catch {
      // Storage-disabled browsers can still use manual authentication.
    }
  })();

  return bootstrapInitialization;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  await initializeAuthBootstrap();
  const headers = new Headers(options.headers);
  const token = authToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { error: raw }; }
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

export function eventStreamUrl(path: string): string {
  const token = authToken();
  const url = new URL(path, window.location.href);
  if (token) url.searchParams.set("token", token);
  return `${url.pathname}${url.search}`;
}
