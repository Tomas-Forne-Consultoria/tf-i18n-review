/**
 * The translation files: one `<locale>.json` per locale in the folder the
 * user picked. Read, flattened to dot-path keys, and written back with the
 * file's own indentation so a save only changes the edited lines.
 */

export type LocaleFile = {
  locale: string;
  handle: FileSystemFileHandle;
  tree: unknown;
  flat: Record<string, string>;
  indent: string | number;
  trailingNewline: boolean;
  lastModified: number;
};

export type Catalogue = Record<string, LocaleFile>;

export function flatten(tree: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") out[path] = node;
    else if (Array.isArray(node))
      node.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i)));
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node))
        walk(v, path ? `${path}.${k}` : k);
  };
  walk(tree, "");
  return out;
}

function detectIndent(text: string): string | number {
  const m = /^[{[]\r?\n([ \t]+)/.exec(text);
  if (!m) return 2;
  return m[1]!.startsWith("\t") ? "\t" : m[1]!.length;
}

async function readFile(
  locale: string,
  handle: FileSystemFileHandle,
): Promise<LocaleFile | null> {
  const file = await handle.getFile();
  const text = await file.text();
  let tree: unknown;
  try {
    tree = JSON.parse(text);
  } catch {
    return null;
  }
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return null;
  return {
    locale,
    handle,
    tree,
    flat: flatten(tree),
    indent: detectIndent(text),
    trailingNewline: text.endsWith("\n"),
    lastModified: file.lastModified,
  };
}

/**
 * Reads every `*.json` in the folder. Files unchanged since `previous` are
 * reused, so polling is cheap and keeps object identity when nothing moved.
 */
export async function readCatalogue(
  dir: FileSystemDirectoryHandle,
  previous: Catalogue | null,
): Promise<Catalogue> {
  const out: Catalogue = {};
  for await (const entry of dir.values()) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const locale = entry.name.slice(0, -".json".length);
    const handle = entry;
    const prev = previous?.[locale];
    if (prev?.lastModified === (await handle.getFile()).lastModified) {
      out[locale] = prev;
      continue;
    }
    const file = await readFile(locale, handle);
    if (file) out[locale] = file;
  }
  return out;
}

export function sameCatalogue(a: Catalogue | null, b: Catalogue): boolean {
  if (!a) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((l) => a[l] === b[l]);
}

/** The file's text with `edits` (dot-path → new text) applied. */
export function serialize(
  file: LocaleFile,
  edits: Record<string, string>,
): string {
  const tree = structuredClone(file.tree) as Record<string, unknown>;
  for (const [key, value] of Object.entries(edits)) {
    const parts = key.split(".");
    let node = tree;
    for (const p of parts.slice(0, -1))
      node = node[p] as Record<string, unknown>;
    node[parts.at(-1)!] = value;
  }
  return (
    JSON.stringify(tree, null, file.indent) + (file.trailingNewline ? "\n" : "")
  );
}

export async function writeFile(file: LocaleFile, text: string): Promise<void> {
  const w = await file.handle.createWritable();
  await w.write(text);
  await w.close();
}
