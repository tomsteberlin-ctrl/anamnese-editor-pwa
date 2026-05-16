import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const distDir = path.join(projectRoot, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(publicDir, distDir, { recursive: true });

console.log(`Built static app into ${distDir}`);
