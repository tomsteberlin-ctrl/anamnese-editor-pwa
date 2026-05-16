import {
  ClientError,
  createFilesCommit,
  directoryExists,
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

function slugify(value, fallback = "fall") {
  const slug = String(value || "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || fallback;
}

function normalizeCaseDate(value) {
  const clean = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  return new Date().toISOString().slice(0, 10);
}

function shortDate(value) {
  const [year, month, day] = normalizeCaseDate(value).split("-");
  return `${year.slice(2)}${month}${day}`;
}

function buildTitle(body) {
  const parts = [
    body.caseDate ? shortDate(body.caseDate) : "",
    body.owner,
    body.species,
    body.animalName,
    body.topic,
  ].filter((part) => String(part || "").trim());
  return String(body.title || parts.join(" ") || "Neuer Fall").trim();
}

function buildTherapyTemplate({ title, owner, animalName, species, topic, caseDate }) {
  const patientLine = [species, animalName].filter(Boolean).join(" ");
  return `# Therapiekonzept - ${title}

## Falluebersicht

- Datum: ${caseDate}
- Besitzer: ${owner || ""}
- Tier: ${patientLine || ""}
- Schwerpunkt: ${topic || ""}

## Aktuelle Fragestellung


## Anamnese und Symptome


## Einschätzung


## Therapieziele


## Therapiekonzept

### Mykotherapie


### Fütterung und Management


### Begleitende Maßnahmen


## Verlaufskontrolle


## Notizen

`;
}

function buildRawDataContent(title, rawData) {
  const content = String(rawData || "").trim();
  return `# Rohdaten - ${title}

${content}
`;
}

async function buildUniqueCaseId(contentRoot, preferredBase) {
  const base = slugify(preferredBase, "fall");
  for (let index = 1; index <= 50; index += 1) {
    const candidate = index === 1 ? base : `${base}-${index}`;
    if (!(await directoryExists(`${contentRoot}/${candidate}`))) {
      return candidate;
    }
  }
  throw new ClientError("Kein freier Fallordner-Name gefunden.", 409);
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

async function handleCreateCase(req) {
  const { contentRoot } = getRepositoryConfig();
  const body = await req.json().catch(() => {
    throw new ClientError("Ungueltige JSON-Anfrage.");
  });

  const rawData = String(body.rawData || "").trim();
  if (!rawData) {
    throw new ClientError("Rohdaten fehlen.");
  }

  const caseDate = normalizeCaseDate(body.caseDate);
  const title = buildTitle({ ...body, caseDate });
  const owner = String(body.owner || "").trim();
  const animalName = String(body.animalName || "").trim();
  const species = String(body.species || "").trim();
  const topic = String(body.topic || "").trim();
  const slugBase = `${shortDate(caseDate)} ${owner} ${species} ${animalName} ${topic}`.trim() || title;
  const caseId = await buildUniqueCaseId(contentRoot, slugBase);
  const casePath = `${contentRoot}/${caseId}`;
  const now = new Date().toISOString();
  const conceptContent = buildTherapyTemplate({ title, owner, animalName, species, topic, caseDate });
  const rohdatenContent = buildRawDataContent(title, rawData);
  const meta = {
    id: caseId,
    title,
    owner,
    animalName,
    species,
    topic,
    caseDate,
    source: "anamnese-editor-pwa",
    importedAt: now,
    updatedAt: now,
    files: [
      { name: "anamnesekonzept.md", sourceName: "App-Vorlage", bytes: Buffer.byteLength(conceptContent, "utf8") },
      { name: "rohdaten.md", sourceName: "App-Eingabe", bytes: Buffer.byteLength(rohdatenContent, "utf8") },
    ],
  };

  const result = await createFilesCommit(
    [
      { path: `${casePath}/anamnesekonzept.md`, content: conceptContent },
      { path: `${casePath}/rohdaten.md`, content: rohdatenContent },
      { path: `${casePath}/meta.json`, content: `${JSON.stringify(meta, null, 2)}\n` },
    ],
    `Create ${caseId} via Anamnese Editor`,
  );

  return json({
    ok: true,
    caseId,
    title,
    openPath: `${casePath}/anamnesekonzept.md`,
    files: [
      `${casePath}/anamnesekonzept.md`,
      `${casePath}/rohdaten.md`,
    ],
    ...result,
  }, 201);
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "");

    if (req.method === "GET" && path === "/api/config") return await handleConfig();
    if (req.method === "GET" && path === "/api/cases") return await handleCases(url);
    if (req.method === "GET" && path === "/api/files") return await handleFiles(url);
    if (req.method === "GET" && path === "/api/file") return await handleReadFile(url);
    if (req.method === "POST" && path === "/api/file") return await handleSaveFile(req);
    if (req.method === "POST" && path === "/api/case") return await handleCreateCase(req);

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
  path: ["/api/config", "/api/cases", "/api/files", "/api/file", "/api/case"],
};
