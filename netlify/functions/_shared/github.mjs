const GITHUB_API = "https://api.github.com";

export class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

function readEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function normalizeRoot(value) {
  return String(value || "cases")
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
}

export function getRepositoryConfig({ allowMissingToken = false } = {}) {
  const owner = readEnv("GITHUB_OWNER").trim();
  const repo = readEnv("GITHUB_REPO").trim();
  const branch = readEnv("GITHUB_BRANCH").trim() || "main";
  const token = readEnv("GITHUB_TOKEN").trim();
  const contentRoot = normalizeRoot(readEnv("CONTENT_ROOT"));

  const missing = [];
  if (!owner) missing.push("GITHUB_OWNER");
  if (!repo) missing.push("GITHUB_REPO");
  if (!allowMissingToken && !token) missing.push("GITHUB_TOKEN");

  if (missing.length) {
    throw new ClientError(`GitHub-Speicher ist nicht vollstaendig konfiguriert: ${missing.join(", ")}`, 500);
  }

  return { owner, repo, branch, token, contentRoot };
}

function encodePath(repoPath) {
  return repoPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function ensureSafeParts(repoPath) {
  const parts = String(repoPath || "").replaceAll("\\", "/").split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ClientError("Ungueltiger Pfad.");
  }
}

export function normalizeCaseId(caseId) {
  const clean = String(caseId || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(clean)) {
    throw new ClientError("Ungueltiger Fallordner.");
  }
  return clean;
}

export function normalizeMarkdownPath(value) {
  const { contentRoot } = getRepositoryConfig({ allowMissingToken: true });
  const clean = String(value || "").replaceAll("\\", "/").trim().replace(/^\/+/, "");
  ensureSafeParts(clean);

  if (!clean.startsWith(`${contentRoot}/`) || !clean.toLowerCase().endsWith(".md")) {
    throw new ClientError("Nur Markdown-Dateien im Content-Ordner koennen bearbeitet werden.");
  }

  return clean;
}

export async function githubRequest(endpoint, options = {}) {
  const { owner, repo, token } = getRepositoryConfig();
  const response = await fetch(`${GITHUB_API}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "anamnese-editor-pwa",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data?.message || `GitHub API Fehler ${response.status}`);
    error.status = response.status;
    error.github = data;
    error.repo = `${owner}/${repo}`;
    throw error;
  }

  return data;
}

export async function listDirectory(repoPath) {
  const { owner, repo, branch } = getRepositoryConfig();
  ensureSafeParts(repoPath);
  const encodedPath = encodePath(repoPath);
  const query = new URLSearchParams({ ref: branch });
  const data = await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}?${query.toString()}`);
  if (!Array.isArray(data)) {
    throw new ClientError("Der angefragte Pfad ist kein Ordner.", 400);
  }
  return data;
}

export async function directoryExists(repoPath) {
  try {
    await listDirectory(repoPath);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

export async function readJsonFile(repoPath) {
  const { owner, repo, branch } = getRepositoryConfig();
  ensureSafeParts(repoPath);
  const encodedPath = encodePath(repoPath);
  const query = new URLSearchParams({ ref: branch });
  try {
    const data = await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}?${query.toString()}`);
    const content = Buffer.from(String(data.content || ""), "base64").toString("utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function readMarkdownFile(repoPath) {
  const { owner, repo, branch } = getRepositoryConfig();
  const cleanPath = normalizeMarkdownPath(repoPath);
  const encodedPath = encodePath(cleanPath);
  const query = new URLSearchParams({ ref: branch });
  const data = await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}?${query.toString()}`);
  if (Array.isArray(data) || data.type !== "file") {
    throw new ClientError("Der angefragte Pfad ist keine Datei.", 400);
  }
  return {
    name: data.name,
    path: data.path,
    sha: data.sha,
    size: data.size,
    content: Buffer.from(String(data.content || ""), "base64").toString("utf8"),
  };
}

export async function updateMarkdownFile(repoPath, content, sha) {
  const { owner, repo, branch } = getRepositoryConfig();
  const cleanPath = normalizeMarkdownPath(repoPath);
  const encodedPath = encodePath(cleanPath);
  const filename = cleanPath.split("/").at(-1);

  if (!sha || typeof sha !== "string") {
    throw new ClientError("GitHub-SHA fehlt. Bitte Datei neu laden.", 409);
  }

  const body = {
    message: `Update ${filename} via Anamnese Editor`,
    content: Buffer.from(String(content ?? ""), "utf8").toString("base64"),
    sha,
    branch,
  };

  const data = await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    body,
  });

  return {
    path: data.content?.path || cleanPath,
    sha: data.content?.sha || "",
    commitSha: data.commit?.sha || "",
    htmlUrl: data.commit?.html_url || "",
  };
}

export async function createFilesCommit(files, message) {
  const { owner, repo, branch } = getRepositoryConfig();
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object?.sha;
  if (!parentSha) {
    throw new ClientError("GitHub-Branch konnte nicht gelesen werden.", 500);
  }

  const parentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree?.sha;
  if (!baseTreeSha) {
    throw new ClientError("GitHub-Baum konnte nicht gelesen werden.", 500);
  }

  const tree = files.map((file) => {
    const cleanPath = String(file.path || "").replaceAll("\\", "/").trim().replace(/^\/+/, "");
    ensureSafeParts(cleanPath);
    return {
      path: cleanPath,
      mode: "100644",
      type: "blob",
      content: String(file.content ?? ""),
    };
  });

  const nextTree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: baseTreeSha,
      tree,
    },
  });

  const nextCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: {
      message,
      tree: nextTree.sha,
      parents: [parentSha],
    },
  });

  await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: {
      sha: nextCommit.sha,
    },
  });

  return {
    commitSha: nextCommit.sha,
    htmlUrl: nextCommit.html_url || "",
  };
}
