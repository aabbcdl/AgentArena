interface EventTarget {
  value?: string;
  id?: string;
  checked?: boolean;
  closest?(selector: string): Element | null;
  click?(): void;
}

interface Event {
  key?: string;
  request?: Request;
  data?: unknown;
  waitUntil?(promise: Promise<unknown>): void;
  respondWith?(response: Promise<Response> | Response): void;
}

interface Element {
  value?: string;
  options?: HTMLOptionsCollection;
  placeholder?: string;
  hidden?: boolean;
  style: CSSStyleDeclaration;
  open?: boolean;
  disabled?: boolean;
  width?: number;
  height?: number;
  dataset: DOMStringMap;
  getContext?(contextId: string): CanvasRenderingContext2D | null;
  click?(): void;
}

interface Window {
  formatDecisionReport?: (report: unknown) => string;
  __agentarenaSwRegistration?: ServiceWorkerRegistration | null;
  showUpdateBanner?: (registration?: ServiceWorkerRegistration) => void;
}

declare const self: {
  addEventListener(type: string, listener: (event: Event) => void): void;
  skipWaiting(): void | Promise<void>;
  clients: {
    claim(): Promise<void>;
  };
};
