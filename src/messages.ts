/** Messages between the side panel and the page script, over one port. */

export const PORT_NAME = "i18n-review";

/** One translated string found on the page. */
export type PageString = {
  key: string;
  /** Elements showing it. */
  count: number;
  /** Text matching only: other keys with the same text. */
  alsoMatches?: string[];
};

export type PageState = {
  url: string;
  /** `<html lang>` as the page declares it. */
  lang: string;
  /** "markers" = the app tags its messages; "text" = matched by content. */
  mode: "markers" | "text" | "none";
  strings: PageString[];
};

export type ToPanel =
  { type: "page"; state: PageState } | { type: "hover"; key: string | null };

export type PreviewItem = { key: string; from: string; to: string };

export type ToPage =
  /** Texts of the page locale, for apps without markers. */
  | { type: "catalogue"; values: Record<string, string> }
  | { type: "highlight"; key: string | null; scroll: boolean }
  /** Outline every string in its review colour; null hides them. */
  | { type: "status"; colors: Record<string, string> | null }
  /** Unsaved edits to show in place. Keys missing here are restored. */
  | { type: "preview"; items: PreviewItem[] };
