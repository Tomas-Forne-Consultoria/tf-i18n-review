/// <reference types="chrome" />
/**
 * Page script. Idle until the side panel connects; then it finds every
 * translated string on the page (by marker, or by matching catalogue text
 * when the app has no markers), reports them in reading order, and draws
 * highlights, review outlines and live previews of unsaved edits.
 */

import { decodeKey, MARKER_RE } from "./protocol";
import {
  PORT_NAME,
  type PageState,
  type PageString,
  type PreviewItem,
  type ToPage,
  type ToPanel,
} from "./messages";

const START = String.fromCodePoint(0xe0001);
const ATTRS = ["placeholder", "title", "aria-label", "alt", "value"];
const SKIP = "script, style, noscript, template";

type Hit = {
  key: string;
  el: Element;
  /** The text node holding the message, or null for an attribute. */
  node: Text | null;
  attr: string | null;
  alsoMatches?: string[];
};

declare global {
  interface Window {
    __i18nReview?: true;
  }
}

if (!window.__i18nReview) {
  window.__i18nReview = true;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_NAME) startSession(port);
  });
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function startSession(port: chrome.runtime.Port) {
  let catalogue: Map<string, string[]> | null = null;
  let hits: Hit[] = [];
  let lastSent = "";
  let hoverKey: string | null = null;
  let highlightKey: string | null = null;
  let statusColors: Record<string, string> | null = null;
  let previews = new Map<string, PreviewItem>();
  /** Nodes/attributes showing a preview → their original value. */
  const originals = new Map<Text | Element, Map<string | null, string>>();

  const host = document.createElement("i18n-review-overlay");
  host.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.appendChild(host);

  const send = (msg: ToPanel) => {
    try {
      port.postMessage(msg);
    } catch {
      stop();
    }
  };

  // ------------------------------------------------------------ scanning

  function scanMarkers(): Hit[] {
    const out: Hit[] = [];
    const walker = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.nodeValue ?? "";
        const el = n.parentElement;
        if (!text.includes(START) || !el || el.closest(SKIP)) continue;
        for (const m of text.matchAll(MARKER_RE))
          out.push({ key: decodeKey(m[1]!), el, node: n as Text, attr: null });
      } else {
        const el = n as Element;
        for (const attr of ATTRS) {
          const v = el.getAttribute(attr);
          if (!v?.includes(START)) continue;
          for (const m of v.matchAll(MARKER_RE))
            out.push({ key: decodeKey(m[1]!), el, node: null, attr });
        }
      }
    }
    return out;
  }

  function scanText(): Hit[] {
    if (!catalogue) return [];
    const out: Hit[] = [];
    const walker = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    const add = (
      keys: string[],
      el: Element,
      node: Text | null,
      attr: string | null,
    ) =>
      out.push({
        key: keys[0]!,
        el,
        node,
        attr,
        alsoMatches: keys.length > 1 ? keys.slice(1) : undefined,
      });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const el = n.parentElement;
        const keys = catalogue.get(normalize(n.nodeValue ?? ""));
        if (keys && el && !el.closest(SKIP)) add(keys, el, n as Text, null);
      } else {
        const el = n as Element;
        for (const attr of ATTRS) {
          const keys = catalogue.get(normalize(el.getAttribute(attr) ?? ""));
          if (keys) add(keys, el, null, attr);
        }
      }
    }
    return out;
  }

  function rescan() {
    let mode: PageState["mode"] = "markers";
    hits = scanMarkers();
    if (!hits.length) {
      hits = scanText();
      mode = hits.length ? "text" : "none";
    }
    applyPreview();
    draw();

    const byKey = new Map<string, PageString>();
    for (const h of hits) {
      const s = byKey.get(h.key);
      if (s) s.count++;
      else
        byKey.set(h.key, { key: h.key, count: 1, alsoMatches: h.alsoMatches });
    }
    const state: PageState = {
      url: location.href,
      lang: document.documentElement.lang,
      mode,
      strings: [...byKey.values()],
    };
    const sig = JSON.stringify(state);
    if (sig !== lastSent) {
      lastSent = sig;
      send({ type: "page", state });
    }
  }

  // ------------------------------------------------------------ preview

  const shown = (s: string) => normalize(s.replace(MARKER_RE, ""));

  function remember(
    target: Text | Element,
    attr: string | null,
    value: string,
  ) {
    const m = originals.get(target) ?? new Map<string | null, string>();
    if (!m.has(attr)) m.set(attr, value);
    originals.set(target, m);
  }

  function applyPreview() {
    // Restore anything previewed for a key that no longer has an edit.
    for (const h of hits) {
      const orig = originals.get(h.node ?? h.el)?.get(h.attr);
      if (orig === undefined || previews.has(h.key)) continue;
      if (h.node) h.node.nodeValue = orig;
      else h.el.setAttribute(h.attr!, orig);
      originals.get(h.node ?? h.el)!.delete(h.attr);
    }
    for (const h of hits) {
      const p = previews.get(h.key);
      if (!p) continue;
      const target = h.node ?? h.el;
      const current = h.node
        ? (h.node.nodeValue ?? "")
        : (h.el.getAttribute(h.attr!) ?? "");
      const wasPreviewed = originals.get(target)?.has(h.attr);
      // Only replace a node that holds exactly this one message.
      if (!wasPreviewed && shown(current) !== normalize(p.from)) continue;
      const markers = [...current.matchAll(MARKER_RE)]
        .map((m) => m[0])
        .join("");
      const lead = /^\s*/.exec(current)![0];
      const next = lead + p.to + markers;
      if (next === current) continue;
      remember(
        target,
        h.attr,
        wasPreviewed ? originals.get(target)!.get(h.attr)! : current,
      );
      if (h.node) h.node.nodeValue = next;
      else h.el.setAttribute(h.attr!, next);
    }
  }

  // ------------------------------------------------------------ overlay

  function box(r: DOMRect, color: string, strong: boolean, label?: string) {
    const b = document.createElement("div");
    b.style.cssText =
      `position:absolute;left:${r.left + scrollX - 2}px;top:${r.top + scrollY - 2}px;` +
      `width:${r.width + 4}px;height:${r.height + 4}px;border:${strong ? 2 : 1}px solid ${color};` +
      `border-radius:3px;background:${strong ? color + "22" : "transparent"};box-sizing:border-box;`;
    if (label) {
      const t = document.createElement("div");
      t.textContent = label;
      t.style.cssText =
        `position:absolute;left:-2px;top:-19px;font:500 11px/17px ui-monospace,monospace;` +
        `background:${color};color:#fff;padding:0 5px;border-radius:3px;white-space:nowrap;`;
      b.appendChild(t);
    }
    shadow.appendChild(b);
  }

  function draw() {
    shadow.replaceChildren();
    if (statusColors)
      for (const h of hits) {
        const c = statusColors[h.key];
        if (c) box(h.el.getBoundingClientRect(), c, false);
      }
    const focus = highlightKey ?? hoverKey;
    if (focus)
      for (const h of hits)
        if (h.key === focus)
          box(
            h.el.getBoundingClientRect(),
            highlightKey ? "#059669" : "#2563eb",
            true,
            focus,
          );
  }

  // ------------------------------------------------------------ events

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rescan, 250);
  };
  const observer = new MutationObserver((records) => {
    if (records.every((r) => r.target === host || host.contains(r.target)))
      return;
    schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });

  const onMove = (e: MouseEvent) => {
    let key: string | null = null;
    outer: for (let el = e.target as Element | null; el; el = el.parentElement)
      for (const h of hits)
        if (h.el === el) {
          key = h.key;
          break outer;
        }
    if (key === hoverKey) return;
    hoverKey = key;
    draw();
    send({ type: "hover", key });
  };
  document.addEventListener("mousemove", onMove, { passive: true });
  addEventListener("resize", draw);

  port.onMessage.addListener((msg: ToPage) => {
    switch (msg.type) {
      case "catalogue": {
        catalogue = new Map();
        for (const [key, value] of Object.entries(msg.values)) {
          const v = normalize(value);
          // ICU, rich text and one-letter strings can't be matched reliably.
          if (v.length < 2 || /[{<]/.test(v)) continue;
          catalogue.set(v, [...(catalogue.get(v) ?? []), key]);
        }
        lastSent = "";
        rescan();
        break;
      }
      case "highlight": {
        highlightKey = msg.key;
        draw();
        const first = hits.find((h) => h.key === msg.key)?.el;
        if (msg.scroll && first) {
          const r = first.getBoundingClientRect();
          if (r.top < 0 || r.bottom > innerHeight)
            first.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        break;
      }
      case "status":
        statusColors = msg.colors;
        draw();
        break;
      case "preview":
        previews = new Map(msg.items.map((i) => [i.key, i]));
        applyPreview();
        draw();
        break;
    }
  });

  function stop() {
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener("mousemove", onMove);
    removeEventListener("resize", draw);
    previews = new Map();
    applyPreview();
    host.remove();
  }
  port.onDisconnect.addListener(stop);

  rescan();
}
