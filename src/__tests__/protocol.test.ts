import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatten, serialize, type LocaleFile } from "../panel/catalogue";
import {
  decodeKey,
  encodeKey,
  markMessages,
  MARKER_RE,
  stripMarkers,
} from "../protocol";

const FIXTURES = join(import.meta.dirname, "../../test/fixtures/locales");

const keysIn = (s: string) =>
  [...s.matchAll(MARKER_RE)].map((m) => decodeKey(m[1]!));

describe("key markers", () => {
  it("round-trips a key and renders as nothing", () => {
    const marked = "Preus" + encodeKey("Landing.nav.pricing");
    expect(keysIn(marked)).toEqual(["Landing.nav.pricing"]);
    expect(stripMarkers(marked)).toBe("Preus");
  });

  it("finds several markers in one string", () => {
    const s = `a${encodeKey("A.one")} – b${encodeKey("B.two_3")}`;
    expect(keysIn(s)).toEqual(["A.one", "B.two_3"]);
  });

  it("marks every string leaf with its dot path, arrays by index", () => {
    const marked = markMessages({
      Nav: {
        home: "Inici",
        count: "{n, plural, one {# llei} other {# lleis}}",
      },
      Faq: { items: [{ q: "Què?", a: "Això." }] },
      n: 3,
    });
    expect(keysIn(marked.Nav.home)).toEqual(["Nav.home"]);
    expect(stripMarkers(marked.Nav.count)).toBe(
      "{n, plural, one {# llei} other {# lleis}}",
    );
    expect(keysIn(marked.Faq.items[0]!.a)).toEqual(["Faq.items.0.a"]);
    expect(marked.n).toBe(3);
  });

  it("covers every key of a catalogue", () => {
    const ca = JSON.parse(readFileSync(join(FIXTURES, "ca.json"), "utf8")) as unknown;
    const flat = flatten(markMessages(ca));
    for (const [key, value] of Object.entries(flat))
      expect(keysIn(value)).toEqual([key]);
  });
});

describe("saving a locale file", () => {
  const text =
    '{\n  "Nav": {\n    "home": "Inici",\n    "list": [\n      "a",\n      "b"\n    ]\n  },\n  "Ã": "é"\n}\n';
  const file: LocaleFile = {
    locale: "ca",
    handle: {} as FileSystemFileHandle,
    tree: JSON.parse(text) as unknown,
    flat: {},
    indent: 2,
    trailingNewline: true,
    lastModified: 0,
  };

  it("rewrites the file byte for byte when nothing changed", () => {
    expect(serialize(file, {})).toBe(text);
  });

  it("changes only the edited lines, arrays included", () => {
    const out = serialize(file, { "Nav.home": "Portada", "Nav.list.1": "c" });
    expect(out).toBe(
      text.replace('"Inici"', '"Portada"').replace('"b"\n', '"c"\n'),
    );
    expect(file.tree).toEqual(JSON.parse(text)); // the loaded tree is untouched
  });

  it("keeps real locale files byte for byte", () => {
    for (const l of ["ca", "es", "en"]) {
      const real = readFileSync(join(FIXTURES, `${l}.json`), "utf8");
      expect(
        serialize({ ...file, tree: JSON.parse(real) as unknown }, {}),
      ).toBe(real);
    }
  });
});
