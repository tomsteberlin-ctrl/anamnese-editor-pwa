import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceRoot = "E:\\001 MYCELIUM\\001 BERATUNG";
const defaultTargetRoot = path.resolve(projectRoot, "..", "beratung-markdown-content", "cases");

const overwrite = process.argv.includes("--overwrite");
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const sourceRoot = path.resolve(positionalArgs[0] || process.env.SOURCE_ROOT || defaultSourceRoot);
const targetRoot = path.resolve(positionalArgs[1] || process.env.CONTENT_TARGET || defaultTargetRoot);

const generatedNames = new Set();

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

function uniqueSlug(base) {
  let slug = base;
  let counter = 2;
  while (generatedNames.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  generatedNames.add(slug);
  return slug;
}

function normalizeMarkdownName(filename, usedNames) {
  const lower = filename.toLowerCase();
  let targetName = `${slugify(path.basename(filename, path.extname(filename)), "dokument")}.md`;

  if (lower.includes("rohdaten")) targetName = "rohdaten.md";
  if (lower.includes("anamnesekonzept") || lower.includes("therapiekonzept")) targetName = "anamnesekonzept.md";

  const base = path.basename(targetName, ".md");
  let candidate = targetName;
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${counter}.md`;
    counter += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getMarkdownFiles(caseDir) {
  const entries = await readdir(caseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function importCase(entry) {
  const sourceDir = path.join(sourceRoot, entry.name);
  const markdownFiles = await getMarkdownFiles(sourceDir);
  if (!markdownFiles.length) return { status: "ignored", title: entry.name };

  const slug = uniqueSlug(slugify(entry.name, "fall"));
  const targetDir = path.join(targetRoot, slug);

  if ((await exists(targetDir)) && !overwrite) {
    return { status: "skipped", title: entry.name, slug, reason: "already exists" };
  }

  await mkdir(targetDir, { recursive: true });

  const usedNames = new Set();
  const copied = [];
  let latestMtime = 0;

  for (const file of markdownFiles) {
    const sourceFile = path.join(sourceDir, file.name);
    const sourceStat = await stat(sourceFile);
    latestMtime = Math.max(latestMtime, sourceStat.mtimeMs);

    const targetName = normalizeMarkdownName(file.name, usedNames);
    const targetFile = path.join(targetDir, targetName);
    await copyFile(sourceFile, targetFile);
    copied.push({
      sourceName: file.name,
      name: targetName,
      bytes: sourceStat.size,
    });
  }

  const meta = {
    id: slug,
    title: entry.name,
    sourceFolder: sourceDir,
    importedAt: new Date().toISOString(),
    updatedAt: latestMtime ? new Date(latestMtime).toISOString() : null,
    files: copied,
  };

  await writeFile(path.join(targetDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  return { status: "imported", title: entry.name, slug, files: copied.length };
}

async function main() {
  await mkdir(targetRoot, { recursive: true });
  const entries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const results = [];
  for (const entry of entries) {
    results.push(await importCase(entry));
  }

  const imported = results.filter((item) => item.status === "imported");
  const skipped = results.filter((item) => item.status === "skipped");
  const ignored = results.filter((item) => item.status === "ignored");

  console.log(`Source: ${sourceRoot}`);
  console.log(`Target: ${targetRoot}`);
  console.log(`Imported: ${imported.length}`);
  console.log(`Skipped existing: ${skipped.length}`);
  console.log(`Ignored without Markdown: ${ignored.length}`);

  for (const item of imported) {
    console.log(`- ${item.slug} (${item.files} files)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
