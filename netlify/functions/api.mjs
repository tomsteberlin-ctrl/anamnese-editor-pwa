import {
  ClientError,
  getRepositoryConfig,
  listDirectory,
  normalizeCaseId,
  normalizeMarkdownPath,
  readJsonFile,
  readMarkdownFile,
  updateMarkdownFile,
} from "./_shared/github.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function sortByName(items) {
  return [...items].sort((a, b) => String(a.name || a.title || a.id).localeCompare(String(b.name || b.title || b.id), "de"));
}

function caseMatchesQuery(item, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [item.id, item.title, item.sourceFolder]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

async function handleConfig() {
  const { owner, repo, branch, contentRoot } = getRepositoryConfig();
  return json({
    storageLabel: `${owner}/${repo}:${branch}/${contentRoot}`,
    contentRoot,
  });
}

async function handleCases(url) {
  const { contentRoot } = getRepositoryConfig();
  const query = url.searchParams.get("q")?.trim() || "";
  const rootItems = await listDirectory(contentRoot);
  const directories = rootItems.filter((item) => item.type === "dir");
  const cases = [];

  for (const directory of directories) {
    const items = await listDirectory(directory.path);
    const markdownFiles = items.filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".md"));
    if (!markdownFiles.length) continue;

    const meta = (await readJsonFile(`${directory.path}/meta.json`)) || {};
    const item = {
      id: directory.name,
      title: meta.title || directory.name,
      sourceFolder: meta.sourceFolder || "",
      updatedAt: meta.updatedAt || meta.importedAt || null,
      markdownCount: markdownFiles.length,
    };

    if (caseMatchesQuery(item, query)) {
      cases.push(item);
    }
  }

  cases.sort((a, b) => {
    const dateDelta = Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
    return dateDelta || b.id.localeCompare(a.id, "de");
  });

  return json({ cases });
}

async function handleFiles(url) {
  const { contentRoot } = getRepositoryConfig();
  const caseId = normalizeCaseId(url.searchParams.get("caseId"));
  const items = await listDirectory(`${contentRoot}/${caseId}`);
  const files = sortByName(
    items
      .filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".md"))
      .map((item) => ({
        name: item.name,
        path: item.path,
        size: item.size || 0,
        sha: item.sha,
      })),
  );

  return json({ caseId, files });
}

async function handleReadFile(url) {
  const filePath = normalizeMarkdownPath(url.searchParams.get("path"));
  const file = await readMarkdownFile(filePath);
  return json(file);
}

async function handleSaveFile(req) {
  const body = await req.json().catch(() => {
    throw new ClientError("Ungueltige JSON-Anfrage.");
  });
  const filePath = normalizeMarkdownPath(body.path);
  const result = await updateMarkdownFile(filePath, body.content, body.sha);
  return json({ ok: true, ...result });
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "");

    if (req.method === "GET" && path === "/api/config") return handleConfig();
    if (req.method === "GET" && path === "/api/cases") return handleCases(url);
    if (req.method === "GET" && path === "/api/files") return handleFiles(url);
    if (req.method === "GET" && path === "/api/file") return handleReadFile(url);
    if (req.method === "POST" && path === "/api/file") return handleSaveFile(req);

    return json({ error: "Route nicht gefunden." }, 404);
  } catch (error) {
    console.error(error);
    const status = error instanceof ClientError ? error.status : error.status || 500;
    const message = status === 409
      ? "Die Datei wurde zwischenzeitlich geaendert. Bitte neu laden."
      : error.message || "Serverfehler.";
    return json({ error: message }, status);
  }
};

export const config = {
  path: ["/api/config", "/api/cases", "/api/files", "/api/file"],
};
