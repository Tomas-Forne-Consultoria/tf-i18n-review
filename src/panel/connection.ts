/// <reference types="chrome" />
/**
 * Follows the tab under review (the active tab, or `?tab=<id>` when the
 * panel is opened as a page) and keeps a port open to its page script,
 * injecting the script where the extension has access to the site.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PORT_NAME,
  type PageState,
  type ToPage,
  type ToPanel,
} from "../messages";

export type Status = "connecting" | "connected" | "no-access" | "unsupported";

type Tab = { id: number; url: string; loads: number };

const pinned = Number(new URLSearchParams(location.search).get("tab")) || null;

function originPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

export function usePageConnection() {
  const [tab, setTab] = useState<Tab | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Each connection reports under its own id, so a reconnect starts from
  // "connecting" and a tab switch drops the previous tab's strings.
  const connId = tab ? `${tab.id}:${tab.loads}:${attempt}` : "";
  const [reported, setReported] = useState<{
    id: string;
    status: Status;
  } | null>(null);
  const [pageBy, setPageBy] = useState<{
    tabId: number;
    state: PageState;
  } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const unsupported = !!tab && !/^https?:/.test(tab.url);
  const status: Status = unsupported
    ? "unsupported"
    : reported?.id === connId
      ? reported.status
      : "connecting";
  const page = pageBy && pageBy.tabId === tab?.id ? pageBy.state : null;
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Which tab, and a reload counter so navigation reconnects.
  useEffect(() => {
    const load = async () => {
      const t = pinned
        ? await chrome.tabs.get(pinned)
        : (
            await chrome.tabs.query({ active: true, lastFocusedWindow: true })
          )[0];
      setTab(t?.id ? { id: t.id, url: t.url ?? "", loads: 0 } : null);
    };
    void load();
    const onActivated = () => {
      if (!pinned) void load();
    };
    const onUpdated = (
      id: number,
      info: chrome.tabs.OnUpdatedInfo,
      t: chrome.tabs.Tab,
    ) => {
      if (info.status !== "complete" && !info.url) return;
      setTab((prev) =>
        prev?.id === id
          ? { id, url: t.url ?? prev.url, loads: prev.loads + 1 }
          : prev,
      );
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onActivated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onActivated);
    };
  }, []);

  useEffect(() => {
    if (!tab || !/^https?:/.test(tab.url)) return;
    const id = `${tab.id}:${tab.loads}:${attempt}`;
    const setStatus = (status: Status) => setReported({ id, status });
    let cancelled = false;
    let port: chrome.runtime.Port | null = null;

    const open = (afterInject: boolean) => {
      let heard = false;
      port = chrome.tabs.connect(tab.id, { name: PORT_NAME });
      portRef.current = port;
      port.onMessage.addListener((msg: ToPanel) => {
        if (cancelled) return;
        if (!heard) {
          heard = true;
          setStatus("connected");
        }
        if (msg.type === "page") setPageBy({ tabId: tab.id, state: msg.state });
        else setHover(msg.key);
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (cancelled) return;
        portRef.current = null;
        // No page script answered: inject it if we may, else ask for access.
        if (!heard && !afterInject) void inject();
        else if (!heard) setStatus("no-access");
      });
    };

    const inject = async () => {
      const allowed = await chrome.permissions.contains({
        origins: [originPattern(tab.url)],
      });
      if (cancelled) return;
      if (!allowed) return setStatus("no-access");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        if (!cancelled) open(true);
      } catch {
        if (!cancelled) setStatus("no-access");
      }
    };

    open(false);
    return () => {
      cancelled = true;
      portRef.current = null;
      port?.disconnect();
    };
  }, [tab, attempt]);

  const send = useCallback((msg: ToPage) => {
    try {
      portRef.current?.postMessage(msg);
    } catch {
      /* page went away; the next load reconnects */
    }
  }, []);

  /** Grants access to the current site and keeps the page script there. */
  const enableSite = useCallback(async () => {
    if (!tab) return;
    const pattern = originPattern(tab.url);
    if (!(await chrome.permissions.request({ origins: [pattern] }))) return;
    const id = `site-${pattern.replace(/[^a-z0-9]/gi, "_")}`;
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [id],
    });
    if (!existing.length)
      await chrome.scripting.registerContentScripts([
        { id, matches: [pattern], js: ["content.js"], runAt: "document_idle" },
      ]);
    setAttempt((n) => n + 1);
  }, [tab]);

  return { tab, status, page, hover, send, enableSite };
}
