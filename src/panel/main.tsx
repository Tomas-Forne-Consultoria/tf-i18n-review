/**
 * Side panel: pick the app's translations folder once per site, then review
 * every string on the current page.
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { readCatalogue, sameCatalogue, type Catalogue } from "./catalogue";
import { usePageConnection } from "./connection";
import { Review } from "./review";
import {
  useProjects,
  withExistingId,
  type Project,
  type Projects,
} from "./state";

function App() {
  const conn = usePageConnection();
  const { projects, save } = useProjects();
  const origin =
    conn.tab && /^https?:/.test(conn.tab.url)
      ? new URL(conn.tab.url).origin
      : null;

  if (!origin || conn.status === "unsupported")
    return (
      <Notice>Open your app in this tab to review its translations.</Notice>
    );
  if (!projects) return null;
  const project = projects[origin];
  const pick = async () => {
    const p = await pickFolder(conn.page?.lang ?? "");
    if (p) save(origin, await withExistingId(p, projects));
  };
  if (!project)
    return (
      <Setup
        origin={origin}
        projects={projects}
        onPick={pick}
        onReuse={(p) => save(origin, p)}
      />
    );
  return (
    <ProjectView
      key={origin}
      project={project}
      conn={conn}
      onChangeFolder={pick}
      onBaseLocale={(baseLocale) => save(origin, { ...project, baseLocale })}
    />
  );
}

async function pickFolder(pageLang: string): Promise<Project | null> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker({
      id: "i18n-review",
      mode: "readwrite",
    });
  } catch {
    return null; // cancelled
  }
  const catalogue = await readCatalogue(dir, null);
  const locales = Object.keys(catalogue).sort();
  if (!locales.length) {
    alert(`No translation files (*.json) in “${dir.name}”.`);
    return null;
  }
  const lang = pageLang.toLowerCase();
  const baseLocale =
    locales.find((l) => l.toLowerCase() === lang) ??
    locales.find((l) => l.toLowerCase() === lang.split("-")[0]) ??
    locales[0]!;
  return { id: crypto.randomUUID(), name: dir.name, dir, baseLocale };
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="notice">{children}</div>;
}

function Setup({
  origin,
  projects,
  onPick,
  onReuse,
}: {
  origin: string;
  projects: Projects;
  onPick: () => void;
  onReuse: (p: Project) => void;
}) {
  const others = Object.entries(projects);
  return (
    <div className="setup">
      <h1>Review translations on {new URL(origin).host}</h1>
      <p>
        Choose the folder with this app’s translation files, one{" "}
        <code>&lt;locale&gt;.json</code> per language (for example{" "}
        <code>src/locales</code>). Edits are saved straight back into those
        files.
      </p>
      <button type="button" className="primary" onClick={onPick}>
        Choose translations folder
      </button>
      {others.length > 0 && (
        <>
          <p className="muted">Or use a folder you already set up:</p>
          {others.map(([o, p]) => (
            <button
              type="button"
              key={o}
              className="link-row"
              onClick={() => onReuse(p)}
            >
              <b>{p.name}</b>{" "}
              <span className="muted">from {new URL(o).host}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function ProjectView({
  project,
  conn,
  onChangeFolder,
  onBaseLocale,
}: {
  project: Project;
  conn: ReturnType<typeof usePageConnection>;
  onChangeFolder: () => void;
  onBaseLocale: (l: string) => void;
}) {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void project.dir.queryPermission({ mode: "readwrite" }).then(setPermission);
  }, [project.dir]);

  // Read the folder, then poll it so outside changes (git pull, an editor)
  // show up and changed-since-done marks follow them.
  useEffect(() => {
    if (permission !== "granted") return;
    let live = true;
    let previous: Catalogue | null = null;
    const tick = async () => {
      try {
        const next = await readCatalogue(project.dir, previous);
        if (!live || sameCatalogue(previous, next)) return;
        previous = next;
        setCatalogue(next);
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [permission, project.dir]);

  if (permission === null) return null;
  if (permission !== "granted")
    return (
      <div className="setup">
        <p>
          Allow access to <b>{project.name}</b> again to keep editing (Chrome
          asks once per session).
        </p>
        <button
          type="button"
          className="primary"
          onClick={() =>
            void project.dir
              .requestPermission({ mode: "readwrite" })
              .then(setPermission)
          }
        >
          Allow access to {project.name}
        </button>
        <button type="button" className="link" onClick={onChangeFolder}>
          Choose another folder
        </button>
      </div>
    );
  if (error)
    return (
      <Notice>
        Could not read {project.name}: {error}
      </Notice>
    );
  if (!catalogue) return null;
  return (
    <Review
      project={project}
      catalogue={catalogue}
      onSaved={setCatalogue}
      conn={conn}
      onChangeFolder={onChangeFolder}
      onBaseLocale={onBaseLocale}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
