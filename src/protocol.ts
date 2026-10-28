/**
 * The contract between an app and the i18n review extension.
 *
 * In inspect mode the app appends an invisible marker to every translated
 * message. The marker spells out the message key in Unicode tag characters
 * (U+E0020–U+E007E, one per ASCII character), wrapped in U+E0001 … U+E007F.
 * Tag characters are default-ignorable, so browsers render nothing, and the
 * marker survives server rendering, hydration and ICU formatting. The
 * extension reads the key straight out of the DOM; it needs no key list.
 *
 * This file has no dependencies so any app can import or copy it.
 */

const START = 0xe0001;
const END = 0xe007f;
const TAG_BASE = 0xe0000;

export const MARKER_RE = /\u{E0001}([\u{E0020}-\u{E007E}]+)\u{E007F}/gu;

/** Message key → invisible marker. Non-ASCII key characters become "?". */
export function encodeKey(key: string): string {
  let out = String.fromCodePoint(START);
  for (const ch of key) {
    const c = ch.codePointAt(0)!;
    out += String.fromCodePoint(TAG_BASE + (c >= 0x20 && c <= 0x7e ? c : 0x3f));
  }
  return out + String.fromCodePoint(END);
}

/** The tag characters captured by MARKER_RE → message key. */
export function decodeKey(tags: string): string {
  let key = "";
  for (const ch of tags)
    key += String.fromCharCode(ch.codePointAt(0)! - TAG_BASE);
  return key;
}

export function stripMarkers(s: string): string {
  return s.replace(MARKER_RE, "");
}

/**
 * Copy of a nested message catalogue with every string leaf suffixed by the
 * marker of its dot-path key (array items use their index: `faq.items.0.q`).
 */
export function markMessages<T>(messages: T, prefix = ""): T {
  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === "string") return node + encodeKey(path);
    if (Array.isArray(node)) return node.map((v, i) => walk(v, `${path}.${i}`));
    if (node && typeof node === "object")
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [
          k,
          walk(v, path ? `${path}.${k}` : k),
        ]),
      );
    return node;
  };
  return walk(messages, prefix) as T;
}
