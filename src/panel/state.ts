/**
 * Everything the panel remembers, per project (keyed by the app's origin):
 * the translations folder, unsaved edits, and review marks. All of it lives
 * in IndexedDB, so it survives closing the panel or the browser.
 */

import { useCallback, useEffect, useState } from "react";
import { idbGet, idbSet } from "./idb";

export type Project = {
  /**
   * Edits and review marks are stored under this id, so every site that
   * uses the same folder (localhost:3000, a preview URL…) shares them.
   */
  id: string;
  /** Folder name, for display. */
  name: string;
  dir: FileSystemDirectoryHandle;
  /** The language others are compared against (missing, same-as, placeholders). */
  baseLocale: string | null;
};

export type Projects = Record<string, Project>;

export function useProjects() {
  const [projects, setProjects] = useState<Projects | null>(null);
  useEffect(() => {
    void idbGet<Projects>("projects").then((p) => setProjects(p ?? {}));
  }, []);
  const save = useCallback((origin: string, project: Project) => {
    setProjects((prev) => {
      const next = { ...prev, [origin]: project };
      void idbSet("projects", next);
      return next;
    });
  }, []);
  return { projects, save };
}

/** A value persisted under `key`; `null` until loaded. */
function usePersisted<T>(key: string, empty: T) {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    let live = true;
    void idbGet<T>(key).then(
      (v) => live && setState({ key, value: v ?? empty }),
    );
    return () => {
      live = false;
    };
    // `empty` is a fresh literal each render; the key decides reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const value = state?.key === key ? state.value : null;
  const update = useCallback(
    (fn: (prev: T) => T) =>
      setState((prev) => {
        if (prev?.key !== key) return prev;
        const next = fn(prev.value);
        void idbSet(key, next);
        return { key, value: next };
      }),
    [key],
  );
  return [value, update] as const;
}

/** Picks up the id of a project that already uses this folder. */
export async function withExistingId(
  project: Project,
  projects: Projects,
): Promise<Project> {
  for (const other of Object.values(projects))
    if (await other.dir.isSameEntry(project.dir))
      return { ...project, id: other.id };
  return project;
}

// ---------------------------------------------------------------- edits

/** locale → key → new text, not yet written to the files. */
export type Edits = Record<string, Record<string, string>>;

export function useEdits(projectId: string) {
  const [edits, update] = usePersisted<Edits>(`edits:${projectId}`, {});
  const set = useCallback(
    (
      locale: string,
      key: string,
      value: string,
      original: string | undefined,
    ) =>
      update((prev) => {
        const forLocale = { ...prev[locale] };
        if (value === original) delete forLocale[key];
        else forLocale[key] = value;
        return { ...prev, [locale]: forLocale };
      }),
    [update],
  );
  const clear = useCallback(
    (locales?: string[]) =>
      update((prev) =>
        locales
          ? Object.fromEntries(
              Object.entries(prev).filter(([l]) => !locales.includes(l)),
            )
          : {},
      ),
    [update],
  );
  return { edits, set, clear };
}

// ---------------------------------------------------------------- review

/**
 * Per key: when you first looked at it in context, when you ticked it done,
 * and every locale's text at that moment. A done key whose texts no longer
 * match the snapshot reads as "changed" until you tick it again.
 */
export type ReviewMark = {
  viewedAt?: number;
  doneAt?: number;
  doneValues?: Record<string, string>;
};

export type ReviewStatus = "done" | "changed" | "viewed" | "new";

export function useReview(projectId: string) {
  const [marks, update] = usePersisted<Record<string, ReviewMark>>(
    `review:${projectId}`,
    {},
  );
  const markViewed = useCallback(
    (key: string) =>
      update((prev) =>
        prev[key]?.viewedAt
          ? prev
          : { ...prev, [key]: { ...prev[key], viewedAt: Date.now() } },
      ),
    [update],
  );
  const setDone = useCallback(
    (key: string, values: Record<string, string> | null) =>
      update((prev) => {
        const viewedAt = prev[key]?.viewedAt ?? Date.now();
        return {
          ...prev,
          [key]: values
            ? { viewedAt, doneAt: Date.now(), doneValues: values }
            : { viewedAt },
        };
      }),
    [update],
  );
  const reset = useCallback(() => update(() => ({})), [update]);
  return { marks, markViewed, setDone, reset };
}

/** Locales whose current text differs from the done snapshot. */
export function changedLocales(
  mark: ReviewMark | undefined,
  current: Record<string, string>,
) {
  if (!mark?.doneAt || !mark.doneValues) return [];
  const snap = mark.doneValues;
  return Object.keys({ ...snap, ...current }).filter(
    (l) => (snap[l] ?? "") !== (current[l] ?? ""),
  );
}

export function statusOf(
  mark: ReviewMark | undefined,
  current: Record<string, string>,
): ReviewStatus {
  if (mark?.doneAt)
    return changedLocales(mark, current).length ? "changed" : "done";
  return mark?.viewedAt ? "viewed" : "new";
}

export function when(ts: number | undefined): string {
  return ts
    ? new Date(ts).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
