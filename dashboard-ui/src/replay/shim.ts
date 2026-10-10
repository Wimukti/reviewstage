// Replaces window.fetch so the shipped PR page (api.ts → fetch) runs with no server. Same-origin
// /api/* calls are answered by the ReplayStore; anything else throws, so a regression that adds
// a network call cannot ship quietly inside the public example. Installed once, before React
// mounts (boot.ts).
import type { ReplayStore } from "./store";

export const API_PREFIX = "/api/";

function urlOf(input: RequestInfo | URL): URL {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, window.location.href);
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  if (raw === undefined || raw === null) return undefined;
  try {
    return JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch {
    return undefined;
  }
}

export function replayFetch(store: ReplayStore): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(API_PREFIX)) {
      throw new TypeError(`replay: network is disabled (${url.href})`);
    }
    const reply = store.handle(methodOf(input, init), url.pathname.slice(API_PREFIX.length - 1) + url.search, await bodyOf(input, init));
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
}

export function installFetchShim(store: ReplayStore): void {
  window.fetch = replayFetch(store);
}
