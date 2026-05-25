import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const logoPath = fileURLToPath(new URL("./assets/logo.png", import.meta.url));
const COLORS = {
  title: "#12343B",
  teal: "#0F766E",
  text: "#1F2933",
  muted: "#667085",
  rule: "#D7E6E3",
};

const PAGE_MARGINS = {
  top: 62,
  right: 57,
  bottom: 68,
  left: 57,
};

let logoBufferPromise = null;

function getLogoBuffer() {
  logoBufferPromise ||= readFirstExistingFile([
    logoPath,
    path.join(process.cwd(), "netlify", "functions", "_shared", "assets", "logo.png"),
    path.join(process.cwd(), "_shared", "assets", "logo.png"),
    path.join(process.cwd(), "assets", "logo.png"),
    path.join(process.env.LAMBDA_TASK_ROOT || "", "netlify", "functions", "_shared", "assets", "logo.png"),
    path.join(process.env.LAMBDA_TASK_ROOT || "", "_shared", "assets", "logo.png"),
    path.join(process.env.LAMBDA_TASK_ROOT || "", "assets", "logo.png"),
  ]);
  return logoBufferPromise;
}

async function readFirstExistingFile(candidates) {
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return await readFile(candidate);
    } catch {
      // Try the next Netlify bundle layout candidate.
    }
  }
  return null;
}

function normalizeFilenamePart(value, fallback = "Konzept") {
  const clean = String(value || "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return clean || fallback;
}

function shortDate(value) {
  const clean = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (match) return `${match[1].slice(2)}${match[2]}${match[3]}`;
  const fallback = new Date().toISOString().slice(0, 10);
  return `${fallback.slice(2, 4)}${fallback.slice(5, 7)}${fallback.slice(8, 10)}`;
}

export function buildPdfFileName(meta = {}, caseId = "fall") {
  const prefix = shortDate(meta.caseDate);
  const owner = normalizeFilenamePart(meta.owner || caseId, "Fall");
  const animal = normalizeFilenamePart(meta.animalName || "Patient", "Patient");
  return `${prefix}_${owner}_${animal}_Anamnesebericht_Therapiekonzept.pdf`;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanInline(value) {
  return normalizeInlineSource(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

function normalizeInlineSource(value) {
  return decodeEntities(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\u202f/g, " ")
    .replace(/\u2011/g, "-")
    .replace(/\u2212/g, "-")
    .replace(/[ \t]+\n/g, "\n");
}

function stripInlineMarkup(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

function cleanLinkTarget(rawUrl) {
  let target = String(rawUrl || "").trim();
  let trailing = "";

  while (/[.,;:!?]$/.test(target)) {
    trailing = `${target.at(-1)}${trailing}`;
    target = target.slice(0, -1);
  }

  while (/[\])}]$/.test(target)) {
    trailing = `${target.at(-1)}${trailing}`;
    target = target.slice(0, -1);
  }

  target = target.replace(/[*_`]+$/g, "");
  const href = /^www\./i.test(target) ? `https://${target}` : target;
  return {
    href,
    text: target,
    trailing,
  };
}

function pushPlainRuns(runs, value) {
  const source = String(value || "");
  if (!source) return;

  const urlPattern = /(?:https?:\/\/|www\.)[^\s<]+/gi;
  let cursor = 0;
  let match = urlPattern.exec(source);

  while (match) {
    const before = stripInlineMarkup(source.slice(cursor, match.index));
    if (before) runs.push({ text: before });

    const link = cleanLinkTarget(match[0]);
    if (link.text) runs.push({ text: link.text, link: link.href });
    if (link.trailing) runs.push({ text: link.trailing });

    cursor = match.index + match[0].length;
    match = urlPattern.exec(source);
  }

  const rest = stripInlineMarkup(source.slice(cursor));
  if (rest) runs.push({ text: rest });
}

function parseInlineRuns(value) {
  const source = normalizeInlineSource(value).trim();
  if (!source) return [];

  const runs = [];
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|www\.[^)\s]+)\)/gi;
  let cursor = 0;
  let match = markdownLinkPattern.exec(source);

  while (match) {
    pushPlainRuns(runs, source.slice(cursor, match.index));

    const link = cleanLinkTarget(match[2]);
    const label = stripInlineMarkup(match[1]).trim();
    if (label && link.href) runs.push({ text: label, link: link.href });
    if (link.trailing) runs.push({ text: link.trailing });

    cursor = match.index + match[0].length;
    match = markdownLinkPattern.exec(source);
  }

  pushPlainRuns(runs, source.slice(cursor));
  return runs.filter((run) => run.text);
}

function flushParagraph(blocks, lines) {
  if (!lines.length) return;
  const text = lines.join("\n").replace(/[ \t]+$/gm, "");
  if (text.trim()) blocks.push({ type: "paragraph", text });
  lines.length = 0;
}

function parseMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const paragraph = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph(blocks, paragraph);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(blocks, paragraph);
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph(blocks, paragraph);
      blocks.push({ type: "listItem", marker: "•", text: bullet[1] });
      continue;
    }

    const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph(blocks, paragraph);
      blocks.push({ type: "listItem", marker: `${numbered[1]}.`, text: numbered[2] });
      continue;
    }

    if (/^\|.+\|$/.test(trimmed)) {
      flushParagraph(blocks, paragraph);
      blocks.push({
        type: "paragraph",
        text: trimmed.split("|").map((cell) => cell.trim()).filter(Boolean).join(" | "),
      });
      continue;
    }

    paragraph.push(line.replace(/[ \t]{2,}$/, ""));
  }

  flushParagraph(blocks, paragraph);
  return blocks;
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function resetTextColumn(doc) {
  doc.x = doc.page.margins.left;
}

function renderInlineText(doc, value, x, y, options = {}) {
  const runs = parseInlineRuns(value);
  if (!runs.length) return false;

  const baseColor = options.color || COLORS.text;
  runs.forEach((run, index) => {
    const isFirst = index === 0;
    const isLast = index === runs.length - 1;
    const textOptions = {
      ...options,
      continued: !isLast,
      link: run.link,
      underline: Boolean(run.link),
    };

    delete textOptions.color;
    doc.fillColor(run.link ? COLORS.teal : baseColor);

    if (isFirst) {
      doc.text(run.text, x, y, textOptions);
    } else {
      doc.text(run.text, textOptions);
    }
  });

  doc.fillColor(baseColor);
  return true;
}

function ensureSpace(doc, height) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) doc.addPage();
}

function drawLogo(doc, logoBuffer) {
  if (!logoBuffer) {
    doc.y += 6;
    return;
  }

  const width = 126;
  const height = 84;
  const x = (doc.page.width - width) / 2;
  doc.image(logoBuffer, x, doc.y, { width });
  doc.y += height + 14;
}

function drawSubtitleRule(doc) {
  const y = doc.y + 5;
  doc
    .save()
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(1.1)
    .strokeColor(COLORS.rule)
    .stroke()
    .restore();
  doc.y = y + 17;
}

function renderHeading(doc, block, state) {
  if (!cleanInline(block.text)) return;

  if (block.level === 1 && state.topHeadingCount === 0) {
    ensureSpace(doc, 42);
    doc.font("Helvetica-Bold").fontSize(19).fillColor(COLORS.title);
    renderInlineText(doc, block.text, doc.page.margins.left, doc.y, {
      width: contentWidth(doc),
      align: "center",
      lineGap: 1,
      color: COLORS.title,
    });
    doc.moveDown(0.25);
    resetTextColumn(doc);
    state.topHeadingCount += 1;
    return;
  }

  if (block.level === 1 && state.topHeadingCount === 1) {
    ensureSpace(doc, 48);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.teal);
    renderInlineText(doc, block.text, doc.page.margins.left, doc.y, {
      width: contentWidth(doc),
      align: "center",
      lineGap: 1,
      color: COLORS.teal,
    });
    drawSubtitleRule(doc);
    resetTextColumn(doc);
    state.topHeadingCount += 1;
    return;
  }

  if (block.level <= 2) {
    ensureSpace(doc, 54);
    doc.moveDown(0.75);
    doc.font("Helvetica-Bold").fontSize(15).fillColor(COLORS.teal);
    renderInlineText(doc, block.text, doc.page.margins.left, doc.y, {
      width: contentWidth(doc),
      lineGap: 1,
      color: COLORS.teal,
    });
    const y = doc.y + 3;
    doc
      .save()
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(0.7)
      .strokeColor(COLORS.rule)
      .stroke()
      .restore();
    doc.y = y + 8;
    resetTextColumn(doc);
    return;
  }

  ensureSpace(doc, 36);
  doc.moveDown(0.45);
  doc.font("Helvetica-Bold").fontSize(block.level === 3 ? 12.4 : 11.2).fillColor(COLORS.title);
  renderInlineText(doc, block.text, doc.page.margins.left, doc.y, {
    width: contentWidth(doc),
    lineGap: 1,
    color: COLORS.title,
  });
  doc.moveDown(0.25);
  resetTextColumn(doc);
}

function renderParagraph(doc, block) {
  if (!cleanInline(block.text)) return;

  ensureSpace(doc, 28);
  doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.text);
  renderInlineText(doc, block.text, doc.page.margins.left, doc.y, {
    width: contentWidth(doc),
    align: "left",
    lineGap: 2.2,
    color: COLORS.text,
  });
  doc.moveDown(0.42);
  resetTextColumn(doc);
}

function renderListItem(doc, block) {
  if (!cleanInline(block.text)) return;

  ensureSpace(doc, 24);
  const x = doc.page.margins.left;
  const y = doc.y;
  const markerWidth = block.marker.length > 1 ? 24 : 16;
  const gap = 6;
  const textX = x + markerWidth + gap;
  doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.text);
  doc.text(block.marker, x, y, {
    width: markerWidth,
    align: "right",
    lineBreak: false,
  });
  doc.y = y;
  renderInlineText(doc, block.text, textX, y, {
    width: contentWidth(doc) - markerWidth - gap,
    lineGap: 2.2,
    color: COLORS.text,
  });
  doc.moveDown(0.18);
  resetTextColumn(doc);
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  const total = range.count;

  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const footerY = doc.page.height - 42;

    doc
      .save()
      .moveTo(left, footerY - 9)
      .lineTo(right, footerY - 9)
      .lineWidth(0.55)
      .strokeColor(COLORS.rule)
      .stroke()
      .font("Helvetica")
      .fontSize(8.2)
      .fillColor(COLORS.muted)
      .text("Tiernaturheilkunde Thomas Steinmetz - Anamnesebericht", left, footerY, {
        width: 330,
        lineBreak: false,
      })
      .text(`Seite ${pageIndex + 1} / ${total}`, left, footerY, {
        width: contentWidth(doc),
        align: "right",
        lineBreak: false,
      })
      .restore();
  }
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function renderConceptPdf({ markdown, meta = {}, caseId = "fall" }) {
  const doc = new PDFDocument({
    size: "A4",
    margins: PAGE_MARGINS,
    bufferPages: true,
    info: {
      Title: meta.title || caseId,
      Author: "Tiernaturheilkunde Thomas Steinmetz",
      Subject: "Anamnesebericht und integratives Therapiekonzept",
      Creator: "Anamnese Editor",
    },
  });
  const done = collectPdf(doc);
  const logoBuffer = await getLogoBuffer();

  drawLogo(doc, logoBuffer);

  const state = { topHeadingCount: 0 };
  for (const block of parseMarkdown(markdown)) {
    if (block.type === "heading") {
      renderHeading(doc, block, state);
    } else if (block.type === "listItem") {
      renderListItem(doc, block);
    } else {
      renderParagraph(doc, block);
    }
  }

  addFooters(doc);
  doc.end();
  return await done;
}
