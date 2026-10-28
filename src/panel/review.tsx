/**
 * The review list: every string on the current page in reading order, all
 * locales editable inline, with viewed / done / changed-since-done marks.
 * Hovering a row highlights the element on the page and vice versa.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readCatalogue,
  serialize,
  writeFile,
  type Catalogue,
} from "./catalogue";
import type { usePageConnection } from "./connection";
import {
  changedLocales,
  statusOf,
  useEdits,
  useReview,
  when,
  type Project,
  type ReviewMark,
  type ReviewStatus,
} from "./state";

type Conn = ReturnType<typeof usePageConnection>;
type Flag = "missing" | "same" | "placeholders";
type Show = "all" | "todo" | "new" | "changed" | "done" | "issues";

const STATUS_COLOR: Record<ReviewStatus, string> = {
  done: "#10b981",
  changed: "#f59e0b",
  viewed: "#38bdf8",
  new: "#f43f5e",
};

function placeholders(s: string): string {
  return [...s.matchAll(/\{(\w+)/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
}

function matchLocale(
  lang: string | undefined,
  locales: string[],
): string | null {
  const l = (lang ?? "").toLowerCase();
  if (!l) return null;
  return (
    locales.find((x) => x.toLowerCase() === l) ??
    locales.find((x) => x.toLowerCase() === l.split("-")[0]) ??
    null
  );
}

export function Review({
  project,
  catalogue,
  onSaved,
  conn,
  onChangeFolder,
  onBaseLocale,
}: {
  project: Project;
  catalogue: Catalogue;
  onSaved: (c: Catalogue) => void;
  conn: Conn;
  onChangeFolder: () => void;
  onBaseLocale: (l: string) => void;
}) {
  const { edits, set, clear } = useEdits(project.id);
  const review = useReview(project.id);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [showOnPage, setShowOnPage] = useState(false);
  const [rowHover, setRowHover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const locales = useMemo(() => {
    const all = Object.keys(catalogue).sort();
    const base =
      project.baseLocale && all.includes(project.baseLocale)
        ? project.baseLocale
        : all[0]!;
    return [base, ...all.filter((l) => l !== base)];
  }, [catalogue, project.baseLocale]);
  const base = locales[0]!;
  const page = conn.page;
  const pageLocale = matchLocale(page?.lang, locales) ?? base;
  const { send } = conn;

  const value = (l: string, k: string) =>
    edits?.[l]?.[k] ?? catalogue[l]?.flat[k] ?? "";
  const current = (k: string) =>
    Object.fromEntries(locales.map((l) => [l, value(l, k)]));
  const status = (k: string) => statusOf(review.marks?.[k], current(k));
  const flagsOf = (k: string) => {
    const out: Record<string, Flag[]> = {};
    const b = value(base, k);
    for (const l of locales) {
      const v = value(l, k);
      const f: Flag[] = [];
      if (!v.trim()) f.push("missing");
      else if (l !== base && v === b && v.length > 12) f.push("same");
      if (v && placeholders(v) !== placeholders(b)) f.push("placeholders");
      if (f.length) out[l] = f;
    }
    return out;
  };

  const strings = page?.strings ?? [];
  const statuses = Object.fromEntries(
    strings.map((s) => [s.key, status(s.key)]),
  );
  const count = (st: ReviewStatus) =>
    strings.filter((s) => statuses[s.key] === st).length;
  const visible = strings.filter(({ key }) => {
    const st = statuses[key];
    if (show === "todo" && st === "done") return false;
    if (
      (show === "new" || show === "changed" || show === "done") &&
      st !== show
    )
      return false;
    if (show === "issues" && !Object.keys(flagsOf(key)).length) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      key.toLowerCase().includes(q) ||
      locales.some((l) => value(l, key).toLowerCase().includes(q))
    );
  });
  const unsaved = Object.values(edits ?? {}).reduce(
    (n, e) => n + Object.keys(e).length,
    0,
  );

  // ---------------------------------------------------------- page sync

  const connected = conn.status === "connected";
  const pageFile = catalogue[pageLocale];
  useEffect(() => {
    if (connected && pageFile)
      send({ type: "catalogue", values: pageFile.flat });
  }, [connected, conn.tab, pageFile, send]);

  const pageEdits = edits?.[pageLocale];
  useEffect(() => {
    if (!connected || !pageFile) return;
    const items = Object.entries(pageEdits ?? {}).map(([key, to]) => ({
      key,
      from: pageFile.flat[key] ?? "",
      to,
    }));
    send({ type: "preview", items });
  }, [connected, conn.tab, pageFile, pageEdits, send]);

  const statusKey = JSON.stringify(statuses);
  useEffect(() => {
    if (!connected) return;
    const s = JSON.parse(statusKey) as Record<string, ReviewStatus>;
    send({
      type: "status",
      colors: showOnPage
        ? Object.fromEntries(
            Object.entries(s).map(([k, st]) => [k, STATUS_COLOR[st]]),
          )
        : null,
    });
  }, [connected, conn.tab, showOnPage, statusKey, send]);

  useEffect(() => {
    if (connected)
      send({ type: "highlight", key: rowHover, scroll: !!rowHover });
  }, [connected, rowHover, send]);

  useEffect(() => {
    if (!conn.hover) return;
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(conn.hover)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [conn.hover]);

  // Looking at a string in context for a moment marks it viewed.
  const focus = rowHover ?? conn.hover;
  const { markViewed } = review;
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => markViewed(focus), 700);
    return () => clearTimeout(t);
  }, [focus, markViewed]);

  // ---------------------------------------------------------- saving

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const touched = Object.entries(edits ?? {}).filter(
        ([, e]) => Object.keys(e).length,
      );
      for (const [l, e] of touched)
        await writeFile(catalogue[l]!, serialize(catalogue[l]!, e));
      onSaved(await readCatalogue(project.dir, catalogue));
      clear(touched.map(([l]) => l));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!edits || !review.marks) return null;
  const marks = review.marks;
  const path = page
    ? new URL(page.url).pathname + new URL(page.url).search
    : "";
  const done = count("done");
  const changed = count("changed");
  const viewed = count("viewed");
  const pct = (n: number) => `${(n / (strings.length || 1)) * 100}%`;

  return (
    <div className="app">
      <header>
        <div className="row">
          <span className="project" title={`Folder: ${project.name}`}>
            {project.name}
          </span>
          <button type="button" className="link" onClick={onChangeFolder}>
            change
          </button>
          <label
            className="muted"
            title="Other languages are compared against this one"
          >
            base{" "}
            <select value={base} onChange={(e) => onBaseLocale(e.target.value)}>
              {locales.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <span
            className="muted"
            title="Kept in the extension until you save or discard them"
          >
            {unsaved} unsaved
          </span>
          <button
            type="button"
            className="primary"
            disabled={!unsaved || saving}
            onClick={() => void save()}
            title={`Write the edits into ${project.name}`}
          >
            {saving ? "Saving…" : "Save to files"}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!unsaved}
            onClick={() =>
              confirm(`Discard ${unsaved} unsaved edits?`) && clear()
            }
          >
            Discard
          </button>
        </div>
        {saveError && <div className="error">Save failed: {saveError}</div>}
        <div className="row page">
          <span className="path" title={page?.url}>
            {path || "…"}
          </span>
          <span className="badge on-screen" title="Language shown on the page">
            {pageLocale}
          </span>
          {page?.mode === "text" && (
            <span
              className="badge warn"
              title="The app has no key markers, so strings were matched by their text. Duplicated texts and texts with variables can be missed or ambiguous."
            >
              matched by text
            </span>
          )}
          <span className="spacer" />
          <span className="muted">{strings.length} strings</span>
        </div>
        <div className="row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by key or text…"
          />
          <select
            value={show}
            onChange={(e) => setShow(e.target.value as Show)}
          >
            <option value="all">All</option>
            <option value="todo">Not done</option>
            <option value="new">Not viewed</option>
            <option value="changed">Changed since done</option>
            <option value="done">Done</option>
            <option value="issues">Issues</option>
          </select>
        </div>
        <div className="row progress-row">
          <div
            className="progress"
            title={`${done} done, ${changed} changed, ${viewed} viewed`}
          >
            <div style={{ width: pct(done), background: STATUS_COLOR.done }} />
            <div
              style={{ width: pct(changed), background: STATUS_COLOR.changed }}
            />
            <div
              style={{ width: pct(viewed), background: STATUS_COLOR.viewed }}
            />
          </div>
          <span>
            <b className="c-done">{done}</b> done ·{" "}
            {changed > 0 && (
              <>
                <b className="c-changed">{changed}</b> changed ·{" "}
              </>
            )}
            <b className="c-viewed">{viewed}</b> viewed ·{" "}
            {strings.length - done - changed - viewed} new
          </span>
          <span className="spacer" />
          <label>
            <input
              type="checkbox"
              checked={showOnPage}
              onChange={(e) => setShowOnPage(e.target.checked)}
            />{" "}
            Show on page
          </label>
          <button
            type="button"
            className="link"
            onClick={() =>
              confirm("Clear every viewed / done mark for this site?") &&
              review.reset()
            }
          >
            reset
          </button>
        </div>
      </header>

      <ConnectionNotice conn={conn} empty={!strings.length} />

      <div
        className="list"
        ref={listRef}
        onMouseLeave={() => setRowHover(null)}
      >
        {visible.map((s) => (
          <Row
            key={s.key}
            k={s.key}
            count={s.count}
            alsoMatches={s.alsoMatches}
            locales={locales}
            pageLocale={pageLocale}
            known={locales.some((l) => s.key in (catalogue[l]?.flat ?? {}))}
            value={value}
            original={(l) => catalogue[l]?.flat[s.key]}
            isEdited={(l) => s.key in (edits[l] ?? {})}
            onEdit={(l, v) => set(l, s.key, v, catalogue[l]?.flat[s.key])}
            flags={flagsOf(s.key)}
            status={statuses[s.key]!}
            mark={marks[s.key]}
            changed={changedLocales(marks[s.key], current(s.key))}
            active={s.key === rowHover || s.key === conn.hover}
            onEnter={() => setRowHover(s.key)}
            onFocus={() => markViewed(s.key)}
            onToggleDone={() =>
              review.setDone(
                s.key,
                statuses[s.key] === "done" ? null : current(s.key),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionNotice({ conn, empty }: { conn: Conn; empty: boolean }) {
  if (conn.status === "connecting")
    return <div className="notice">Connecting to the page…</div>;
  if (conn.status === "no-access")
    return (
      <div className="notice">
        <p>The extension can’t read this site yet.</p>
        <button
          type="button"
          className="primary"
          onClick={() => void conn.enableSite()}
        >
          Enable on {conn.tab ? new URL(conn.tab.url).host : "this site"}
        </button>
      </div>
    );
  if (empty)
    return (
      <div className="notice">
        No translated strings found on this page. For exact results, have the
        app tag its messages in dev (see the extension README); otherwise
        strings are matched by their text.
      </div>
    );
  return null;
}

const FLAG_TITLE: Record<Flag, string> = {
  missing: "missing",
  same: "same as the base language",
  placeholders: "placeholders differ from the base language",
};

function Row(props: {
  k: string;
  count: number;
  alsoMatches?: string[];
  locales: string[];
  pageLocale: string;
  known: boolean;
  value: (l: string, k: string) => string;
  original: (l: string) => string | undefined;
  isEdited: (l: string) => boolean;
  onEdit: (l: string, v: string) => void;
  flags: Record<string, Flag[]>;
  status: ReviewStatus;
  mark: ReviewMark | undefined;
  changed: string[];
  active: boolean;
  onEnter: () => void;
  onFocus: () => void;
  onToggleDone: () => void;
}) {
  const { k, status: st, mark } = props;
  const [expanded, setExpanded] = useState(false);
  const collapsed = st === "done" && !expanded;
  const ns = k.split(".");
  const leaf = ns.pop();

  return (
    <div
      data-key={k}
      onMouseEnter={props.onEnter}
      className={["item", `st-${st}`, props.active ? "active" : ""].join(" ")}
    >
      <div className="key">
        {st === "done" && (
          <button
            type="button"
            className="caret"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        <span className="ns">{ns.length ? ns.join(".") + "." : ""}</span>
        <span className="leaf">{leaf}</span>
        {props.count > 1 && <span className="muted">×{props.count}</span>}
        <label
          className={`done done-${st}`}
          title={
            st === "changed"
              ? `Done ${when(mark?.doneAt)}, then the text changed. Tick to accept the new text.`
              : mark?.doneAt
                ? `Done ${when(mark.doneAt)} · viewed ${when(mark.viewedAt)}`
                : mark?.viewedAt
                  ? `Viewed ${when(mark.viewedAt)}`
                  : "Not viewed yet"
          }
        >
          <input
            type="checkbox"
            checked={st === "done"}
            onChange={props.onToggleDone}
          />
          {st === "done"
            ? `Done ${when(mark?.doneAt)}`
            : st === "changed"
              ? "Changed — review"
              : "Done"}
        </label>
      </div>
      {props.alsoMatches && (
        <div className="note">Same text as {props.alsoMatches.join(", ")}</div>
      )}
      {!props.known ? (
        <div className="note">Not in your translation files.</div>
      ) : collapsed ? (
        <button
          type="button"
          className="summary"
          onClick={() => setExpanded(true)}
        >
          {props.value(props.pageLocale, k)}
        </button>
      ) : (
        props.locales.map((l) => {
          const v = props.value(l, k);
          const flags = props.flags[l];
          const was = props.changed.includes(l)
            ? (mark?.doneValues?.[l] ?? "")
            : undefined;
          return (
            <div className="field" key={l}>
              <span
                className={[
                  "code",
                  was !== undefined
                    ? "f-changed"
                    : flags
                      ? `f-${flags[0]}`
                      : l === props.pageLocale
                        ? "on-screen"
                        : "",
                ].join(" ")}
                title={
                  was !== undefined
                    ? "changed since done"
                    : flags?.map((f) => FLAG_TITLE[f]).join(", ")
                }
              >
                {l}
              </span>
              <div className="grow">
                <textarea
                  rows={Math.min(4, Math.ceil(v.length / 52) || 1)}
                  value={v}
                  onChange={(e) => props.onEdit(l, e.target.value)}
                  onFocus={props.onFocus}
                  className={props.isEdited(l) ? "edited" : ""}
                />
                {was !== undefined && (
                  <div className="was">
                    was: <s>{was || "(empty)"}</s>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
