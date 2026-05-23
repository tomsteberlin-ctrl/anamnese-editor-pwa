const state = {
  storageLabel: "",
  cases: [],
  files: [],
  caseId: "",
  caseName: "",
  fileName: "",
  filePath: "",
  sha: "",
  content: "",
  original: "",
  mode: "preview",
  dirty: false,
  sections: [],
  previewSegments: [],
  findIndex: 0,
};

const el = {
  baseDir: document.querySelector("#baseDir"),
  folderSearch: document.querySelector("#folderSearch"),
  folderList: document.querySelector("#folderList"),
  fileList: document.querySelector("#fileList"),
  activeFile: document.querySelector("#activeFile"),
  activePath: document.querySelector("#activePath"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  newCaseButton: document.querySelector("#newCaseButton"),
  codexBriefingButton: document.querySelector("#codexBriefingButton"),
  aiDraftButton: document.querySelector("#aiDraftButton"),
  reloadButton: document.querySelector("#reloadButton"),
  deleteCaseButton: document.querySelector("#deleteCaseButton"),
  saveButton: document.querySelector("#saveButton"),
  tabs: document.querySelectorAll(".tab"),
  findInput: document.querySelector("#findInput"),
  findNextButton: document.querySelector("#findNextButton"),
  replaceInput: document.querySelector("#replaceInput"),
  replaceAllButton: document.querySelector("#replaceAllButton"),
  editView: document.querySelector("#editView"),
  sectionsView: document.querySelector("#sectionsView"),
  previewView: document.querySelector("#previewView"),
  markdownEditor: document.querySelector("#markdownEditor"),
  sectionNav: document.querySelector("#sectionNav"),
  sectionEditor: document.querySelector("#sectionEditor"),
  preview: document.querySelector("#preview"),
  newCaseDialog: document.querySelector("#newCaseDialog"),
  newCaseForm: document.querySelector("#newCaseForm"),
  newCaseDate: document.querySelector("#newCaseDate"),
  newCaseOwner: document.querySelector("#newCaseOwner"),
  newCaseAnimal: document.querySelector("#newCaseAnimal"),
  newCaseSpecies: document.querySelector("#newCaseSpecies"),
  newCaseTopic: document.querySelector("#newCaseTopic"),
  newCaseTitle: document.querySelector("#newCaseTitle"),
  newCaseRaw: document.querySelector("#newCaseRaw"),
  cancelNewCaseButton: document.querySelector("#cancelNewCaseButton"),
  conflictDialog: document.querySelector("#conflictDialog"),
};

const debounce = (fn, delay = 250) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

async function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const requestUrl = new URL(url, window.location.origin);
  if (method.toUpperCase() === "GET") {
    requestUrl.searchParams.set("_ts", String(Date.now()));
  }

  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    ...options,
    method,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Anfrage fehlgeschlagen.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function setStatus(text, kind = "idle") {
  el.saveStatus.textContent = text;
  el.saveStatus.className = `status ${kind}`;
}

function formatDate(value) {
  if (!value) return "kein Datum";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function todayInputValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function parseMarkdownSegments(markdown) {
  const lines = markdown.split(/\r?\n/);
  const segments = [];
  let current = null;

  const flushCurrent = () => {
    if (!current) return;
    current.markdown = current.lines.join("\n");
    segments.push(current);
    current = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushCurrent();
      segments.push({ type: "blank", markdown: line });
      continue;
    }

    if (/^(#{1,4})\s+/.test(line)) {
      flushCurrent();
      segments.push({ type: "heading", markdown: line, lines: [line] });
      continue;
    }

    const type = /^\s*-\s+/.test(line) ? "list" : "paragraph";
    if (!current || current.type !== type) {
      flushCurrent();
      current = { type, lines: [] };
    }
    current.lines.push(line);
  }

  flushCurrent();
  return segments;
}

function editableAttributes(index) {
  return `data-segment-index="${index}" contenteditable="true" spellcheck="true" tabindex="0"`;
}

function renderMarkdownSegment(segment, index) {
  if (segment.type === "blank") return "";

  if (segment.type === "heading") {
    const heading = /^(#{1,4})\s+(.*)$/.exec(segment.markdown);
    if (!heading) return "";
    const level = heading[1].length;
    return `<h${level} ${editableAttributes(index)}>${inlineMarkdown(heading[2])}</h${level}>`;
  }

  const lines = segment.markdown.split(/\n/);
  if (segment.type === "list") {
    const items = lines
      .map((line) => /^\s*-\s+(.*)$/.exec(line))
      .filter(Boolean)
      .map((match) => `<li>${inlineMarkdown(match[1])}</li>`)
      .join("");
    return `<ul ${editableAttributes(index)}>${items}</ul>`;
  }

  const body = lines.map((line) => inlineMarkdown(line.trim())).join("<br>");
  return `<p ${editableAttributes(index)}>${body}</p>`;
}

function renderMarkdown(markdown) {
  const segments = parseMarkdownSegments(markdown);
  const html = segments.map((segment, index) => renderMarkdownSegment(segment, index)).join("\n");
  return { html, segments };
}

function inlineDomToMarkdown(node) {
  const parts = [];

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent.replace(/\u00a0/g, " "));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (tag === "br") {
      parts.push("\n");
      continue;
    }

    const value = inlineDomToMarkdown(child);
    if (tag === "strong" || tag === "b") {
      parts.push(`**${value}**`);
    } else if (tag === "em" || tag === "i") {
      parts.push(`*${value}*`);
    } else if (tag === "code") {
      parts.push(`\`${value.replaceAll("`", "\\`")}\``);
    } else if (tag === "div" || tag === "p") {
      parts.push(`${value}\n`);
    } else {
      parts.push(value);
    }
  }

  return parts.join("");
}

function cleanPreviewText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function previewBlockToMarkdown(block) {
  const tag = block.tagName.toLowerCase();

  if (/^h[1-4]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const text = cleanPreviewText(inlineDomToMarkdown(block)).replace(/\n+/g, " ").trim();
    return `${"#".repeat(level)} ${text}`;
  }

  if (tag === "ul") {
    const items = Array.from(block.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((item) => cleanPreviewText(inlineDomToMarkdown(item)).replace(/\n+/g, " ").trim())
      .filter(Boolean);
    return items.map((item) => `- ${item}`).join("\n");
  }

  return cleanPreviewText(inlineDomToMarkdown(block));
}

function syncContentFromPreviewBlock(block) {
  const index = Number(block.dataset.segmentIndex);
  const segment = state.previewSegments[index];
  if (!segment || segment.type === "blank") return;

  segment.markdown = previewBlockToMarkdown(block);
  state.content = state.previewSegments.map((item) => item.markdown).join("\n");
  if (el.markdownEditor.value !== state.content) {
    el.markdownEditor.value = state.content;
  }
  markDirty(state.content !== state.original);
}

const refreshPreview = debounce(() => {
  const rendered = renderMarkdown(state.content || "");
  state.previewSegments = rendered.segments;
  el.preview.innerHTML = rendered.html;
}, 180);

function markDirty(isDirty = true) {
  state.dirty = isDirty;
  setStatus(isDirty ? "Nicht gespeichert" : "Gespeichert", isDirty ? "dirty" : "saved");
}

function syncEditorFromState() {
  if (el.markdownEditor.value !== state.content) {
    el.markdownEditor.value = state.content;
  }
  refreshPreview();
}

function updateDocumentHead() {
  el.activeFile.textContent = state.fileName || "Keine Datei geöffnet";
  el.activePath.textContent = state.filePath || (state.caseName ? `${state.caseName}` : "");
}

function clearActiveCase() {
  state.caseId = "";
  state.caseName = "";
  state.fileName = "";
  state.filePath = "";
  state.sha = "";
  state.content = "";
  state.original = "";
  state.files = [];
  state.sections = [];
  state.findIndex = 0;
  state.dirty = false;
  el.markdownEditor.value = "";
  el.preview.innerHTML = "";
  el.sectionNav.replaceChildren();
  el.sectionEditor.replaceChildren();
  updateDocumentHead();
  renderFiles();
}

function renderCases() {
  el.folderList.replaceChildren();
  if (!state.cases.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "Keine Fallordner gefunden";
    el.folderList.append(empty);
    return;
  }

  for (const item of state.cases) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-item${item.id === state.caseId ? " active" : ""}`;
    const countLabel = item.markdownCount === 1 ? "1 Markdown-Datei" : `${item.markdownCount} Markdown-Dateien`;
    button.innerHTML = `${escapeHtml(item.title || item.id)}<small>${formatDate(item.updatedAt)} · ${countLabel}</small>`;
    button.addEventListener("click", () => selectCase(item));
    el.folderList.append(button);
  }
}

function renderFiles() {
  el.fileList.replaceChildren();
  if (!state.caseId) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "Erst Fallordner wählen";
    el.fileList.append(empty);
    return;
  }
  if (!state.files.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.textContent = "Keine Markdown-Dateien";
    el.fileList.append(empty);
    return;
  }

  for (const file of state.files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-item${file.path === state.filePath ? " active" : ""}`;
    button.innerHTML = `${escapeHtml(file.name)}<small>${Math.round(file.size / 1024)} KB</small>`;
    button.addEventListener("click", () => loadFile(file.path));
    el.fileList.append(button);
  }
}

async function loadConfig() {
  const config = await requestJson("/api/config");
  state.storageLabel = config.storageLabel || "GitHub";
  el.baseDir.textContent = state.storageLabel;
}

async function loadCases(query = "") {
  setStatus("Fallordner laden", "idle");
  const data = await requestJson(`/api/cases?q=${encodeURIComponent(query)}`);
  state.cases = data.cases;
  renderCases();
  setStatus("Bereit", "idle");
}

async function selectCase(item) {
  if (state.dirty && !window.confirm("Die aktuelle Datei ist nicht gespeichert. Trotzdem den Fallordner wechseln?")) {
    return;
  }
  state.caseId = item.id;
  state.caseName = item.title || item.id;
  state.fileName = "";
  state.filePath = "";
  state.sha = "";
  state.content = "";
  state.original = "";
  el.markdownEditor.value = "";
  el.preview.innerHTML = "";
  el.sectionNav.replaceChildren();
  el.sectionEditor.replaceChildren();
  updateDocumentHead();
  renderCases();
  setStatus("Dateien laden", "idle");
  const data = await requestJson(`/api/files?caseId=${encodeURIComponent(item.id)}`);
  state.files = data.files;
  renderFiles();
  markDirty(false);
}

async function loadFile(filePath) {
  if (state.dirty && !window.confirm("Die aktuelle Datei ist nicht gespeichert. Trotzdem eine andere Datei öffnen?")) {
    return;
  }
  setStatus("Datei laden", "idle");
  const data = await requestJson(`/api/file?path=${encodeURIComponent(filePath)}`);
  state.fileName = data.name;
  state.filePath = data.path;
  state.sha = data.sha;
  state.content = data.content;
  state.original = data.content;
  state.findIndex = 0;
  syncEditorFromState();
  renderFiles();
  updateDocumentHead();
  if (state.mode === "sections") renderSections();
  markDirty(false);
}

async function refreshActiveCase() {
  if (state.dirty && !window.confirm("Ungespeicherte Änderungen verwerfen und aktuellen Stand neu laden?")) {
    return;
  }

  const activeCaseId = state.caseId;
  const activeFilePath = state.filePath;

  setStatus("Aktualisieren", "idle");
  await loadConfig();
  await loadCases(el.folderSearch.value);

  if (!activeCaseId) {
    setStatus("Fallliste aktualisiert", "saved");
    return;
  }

  const currentCase = state.cases.find((item) => item.id === activeCaseId);
  if (!currentCase) {
    clearActiveCase();
    setStatus("Fall nicht gefunden", "error");
    window.alert("Der aktive Fall wurde im Content-Speicher nicht gefunden. Die Fallliste wurde aktualisiert.");
    return;
  }

  state.caseId = currentCase.id;
  state.caseName = currentCase.title || currentCase.id;
  renderCases();

  const filesData = await requestJson(`/api/files?caseId=${encodeURIComponent(activeCaseId)}`);
  state.files = filesData.files;
  renderFiles();
  updateDocumentHead();

  if (!activeFilePath) {
    markDirty(false);
    setStatus("Fall aktualisiert", "saved");
    return;
  }

  const fileExists = state.files.some((file) => file.path === activeFilePath);
  if (!fileExists) {
    state.fileName = "";
    state.filePath = "";
    state.sha = "";
    state.content = "";
    state.original = "";
    syncEditorFromState();
    renderFiles();
    updateDocumentHead();
    markDirty(false);
    setStatus("Datei nicht gefunden", "error");
    window.alert("Die zuvor geöffnete Datei wurde im Content-Speicher nicht mehr gefunden.");
    return;
  }

  await loadFile(activeFilePath);
  setStatus("Aktualisiert", "saved");
}

async function saveFile() {
  if (!state.filePath) {
    setStatus("Keine Datei", "error");
    return;
  }

  setStatus("Speichern", "idle");
  try {
    const data = await requestJson("/api/file", {
      method: "POST",
      body: JSON.stringify({
        path: state.filePath,
        content: state.content,
        sha: state.sha,
      }),
    });
    state.original = state.content;
    state.sha = data.sha;
    updateDocumentHead();
    markDirty(false);
    await loadCases(el.folderSearch.value);
    if (state.caseId) {
      const filesData = await requestJson(`/api/files?caseId=${encodeURIComponent(state.caseId)}`);
      state.files = filesData.files;
      renderFiles();
    }
    setStatus("Gespeichert", "saved");
  } catch (error) {
    if (error.status === 409) {
      const choice = await showConflictDialog();
      if (choice === "reload") await loadFile(state.filePath);
      return;
    }
    console.error(error);
    setStatus("Fehler", "error");
    window.alert(error.message);
  }
}

function openNewCaseDialog() {
  if (state.dirty && !window.confirm("Die aktuelle Datei ist nicht gespeichert. Trotzdem einen neuen Fall anlegen?")) {
    return;
  }
  el.newCaseForm.reset();
  el.newCaseDate.value = todayInputValue();
  el.newCaseSpecies.value = "Pferd";
  el.newCaseDialog.showModal();
  el.newCaseOwner.focus();
}

async function createCase(event) {
  event.preventDefault();
  const submitButton = el.newCaseForm.querySelector('button[type="submit"]');
  const payload = {
    caseDate: el.newCaseDate.value,
    owner: el.newCaseOwner.value.trim(),
    animalName: el.newCaseAnimal.value.trim(),
    species: el.newCaseSpecies.value.trim(),
    topic: el.newCaseTopic.value.trim(),
    title: el.newCaseTitle.value.trim(),
    rawData: el.newCaseRaw.value.trim(),
  };

  if (!payload.rawData) {
    el.newCaseRaw.focus();
    setStatus("Rohdaten fehlen", "error");
    return;
  }

  submitButton.disabled = true;
  setStatus("Fall anlegen", "idle");

  try {
    const data = await requestJson("/api/case", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    el.newCaseDialog.close();
    el.newCaseForm.reset();
    state.files = [];
    state.filePath = "";
    await loadCases(el.folderSearch.value);
    const createdCase = state.cases.find((item) => item.id === data.caseId) || {
      id: data.caseId,
      title: data.title,
    };
    await selectCase(createdCase);
    await loadFile(data.openPath);
    setMode("preview");
    setStatus("Fall angelegt", "saved");
  } catch (error) {
    console.error(error);
    setStatus("Fehler", "error");
    window.alert(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

async function prepareCodexBriefing() {
  if (!state.caseId) {
    setStatus("Kein Fall gewaehlt", "error");
    window.alert("Bitte zuerst links einen Fall auswaehlen.");
    return;
  }

  if (state.dirty && !window.confirm("Ungespeicherte Aenderungen werden nicht ins Codex-Briefing uebernommen. Trotzdem fortfahren?")) {
    return;
  }

  el.codexBriefingButton.disabled = true;
  setStatus("Briefing erstellen", "idle");

  try {
    const data = await requestJson("/api/briefing", {
      method: "POST",
      body: JSON.stringify({ caseId: state.caseId }),
    });

    state.dirty = false;
    await loadCases(el.folderSearch.value);
    const currentCase = state.cases.find((item) => item.id === data.caseId) || {
      id: data.caseId,
      title: state.caseName,
    };
    await selectCase(currentCase);
    await loadFile(data.path);
    setMode("preview");
    setStatus("Briefing bereit", "saved");
  } catch (error) {
    console.error(error);
    setStatus("Fehler", "error");
    window.alert(error.message);
  } finally {
    el.codexBriefingButton.disabled = false;
  }
}

async function deleteCurrentCase() {
  if (!state.caseId) {
    setStatus("Kein Fall gewählt", "error");
    window.alert("Bitte zuerst links einen Fall auswählen.");
    return;
  }

  if (state.dirty && !window.confirm("Die aktuelle Datei ist nicht gespeichert. Beim Löschen gehen diese Änderungen verloren. Trotzdem fortfahren?")) {
    return;
  }

  const caseId = state.caseId;
  const caseName = state.caseName || caseId;
  const confirmation = window.prompt(
    `Fall "${caseName}" wirklich löschen?\n\nDas löscht alle Dateien in diesem Fallordner per GitHub-Commit.\n\nBitte zur Bestätigung die Fall-ID eingeben:\n${caseId}`,
  );

  if (confirmation === null) return;
  if (confirmation.trim() !== caseId) {
    setStatus("Nicht gelöscht", "error");
    window.alert("Die Eingabe passt nicht zur Fall-ID. Der Fall wurde nicht gelöscht.");
    return;
  }

  el.deleteCaseButton.disabled = true;
  setStatus("Fall löschen", "idle");

  try {
    const data = await requestJson("/api/case", {
      method: "DELETE",
      body: JSON.stringify({
        caseId,
        confirmCaseId: confirmation.trim(),
      }),
    });

    clearActiveCase();
    await loadCases(el.folderSearch.value);
    setStatus(`Fall gelöscht (${data.deletedCount} Dateien)`, "saved");
  } catch (error) {
    console.error(error);
    setStatus("Löschen fehlgeschlagen", "error");
    window.alert(error.message);
  } finally {
    el.deleteCaseButton.disabled = false;
  }
}

async function generateAiDraft() {
  if (!state.caseId) {
    setStatus("Kein Fall gewählt", "error");
    window.alert("Bitte zuerst links einen Fall auswählen.");
    return;
  }

  if (state.dirty && !window.confirm("Ungespeicherte Änderungen werden durch den KI-Entwurf überschrieben. Trotzdem fortfahren?")) {
    return;
  }

  el.aiDraftButton.disabled = true;
  setStatus("KI arbeitet", "idle");

  try {
    const data = await requestJson("/api/draft", {
      method: "POST",
      body: JSON.stringify({ caseId: state.caseId }),
    });

    await loadFile(data.targetPath);
    state.content = data.content;
    syncEditorFromState();
    if (state.mode === "sections") renderSections();
    setMode("preview");
    markDirty(true);
    setStatus("KI-Entwurf bereit", "dirty");
  } catch (error) {
    console.error(error);
    setStatus("KI-Fehler", "error");
    window.alert(error.message);
  } finally {
    el.aiDraftButton.disabled = false;
  }
}

function showConflictDialog() {
  return new Promise((resolve) => {
    el.conflictDialog.addEventListener(
      "close",
      () => resolve(el.conflictDialog.returnValue),
      { once: true },
    );
    el.conflictDialog.showModal();
  });
}

function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = {
    id: "section-0",
    level: 0,
    heading: "Vorspann",
    headingLine: "",
    body: [],
  };

  for (const line of lines) {
    const match = /^(#{1,4})\s+(.*)$/.exec(line);
    if (match) {
      sections.push(current);
      current = {
        id: `section-${sections.length}`,
        level: match[1].length,
        heading: match[2].trim(),
        headingLine: line,
        body: [],
      };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);
  return sections.filter((section) => section.headingLine || section.body.join("").trim());
}

function rebuildFromSections() {
  state.content = state.sections
    .map((section) => {
      const body = section.body.join("\n");
      if (!section.headingLine) return body;
      return `${section.headingLine}\n${body}`;
    })
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n");
  syncEditorFromState();
  markDirty(state.content !== state.original);
}

function renderSections() {
  state.sections = parseSections(state.content || "");
  el.sectionNav.replaceChildren();
  el.sectionEditor.replaceChildren();

  if (!state.sections.length) {
    const empty = document.createElement("p");
    empty.textContent = "Keine Abschnitte erkannt.";
    el.sectionEditor.append(empty);
    return;
  }

  state.sections.forEach((section, index) => {
    const navButton = document.createElement("button");
    navButton.type = "button";
    navButton.className = `level-${Math.min(section.level || 1, 4)}`;
    navButton.textContent = section.heading;
    navButton.addEventListener("click", () => {
      document.querySelector(`#${section.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    el.sectionNav.append(navButton);

    const block = document.createElement("section");
    block.className = "section-block";
    block.id = section.id;

    const heading = document.createElement("div");
    heading.className = "section-heading";
    heading.innerHTML = `<strong>${escapeHtml(section.heading)}</strong><span>${section.headingLine || "ohne Überschrift"}</span>`;

    const textarea = document.createElement("textarea");
    textarea.spellcheck = true;
    textarea.value = section.body.join("\n");
    textarea.addEventListener("input", () => {
      state.sections[index].body = textarea.value.split(/\r?\n/);
      rebuildFromSections();
    });

    block.append(heading, textarea);
    el.sectionEditor.append(block);
  });
}

function setMode(mode) {
  state.mode = mode;
  el.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  el.editView.classList.toggle("active", mode === "edit");
  el.sectionsView.classList.toggle("active", mode === "sections");
  el.previewView.classList.toggle("active", mode === "preview");
  if (mode === "sections") renderSections();
  if (mode === "preview") refreshPreview();
}

function findNext() {
  const term = el.findInput.value;
  if (!term) return;
  setMode("edit");
  const text = el.markdownEditor.value;
  let index = text.toLowerCase().indexOf(term.toLowerCase(), state.findIndex);
  if (index < 0 && state.findIndex > 0) {
    index = text.toLowerCase().indexOf(term.toLowerCase(), 0);
  }
  if (index < 0) {
    setStatus("Nicht gefunden", "error");
    return;
  }
  el.markdownEditor.focus();
  el.markdownEditor.setSelectionRange(index, index + term.length);
  state.findIndex = index + term.length;
  setStatus("Gefunden", "idle");
}

function replaceAll() {
  const term = el.findInput.value;
  if (!term) return;
  const replacement = el.replaceInput.value;
  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const next = state.content.replace(pattern, replacement);
  if (next === state.content) {
    setStatus("Kein Treffer", "error");
    return;
  }
  state.content = next;
  syncEditorFromState();
  if (state.mode === "sections") renderSections();
  markDirty(state.content !== state.original);
}

const debouncedCaseSearch = debounce(() => loadCases(el.folderSearch.value).catch(showFatal), 250);

function showFatal(error) {
  console.error(error);
  setStatus("Fehler", "error");
  window.alert(error.message || "Ein Fehler ist aufgetreten.");
}

function setupPwaInstall() {
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    el.installButton.hidden = false;
  });
  el.installButton.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    el.installButton.hidden = true;
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service Worker konnte nicht registriert werden.", error);
    });
  });
}

el.folderSearch.addEventListener("input", debouncedCaseSearch);
el.newCaseButton.addEventListener("click", openNewCaseDialog);
el.codexBriefingButton.addEventListener("click", () => prepareCodexBriefing().catch(showFatal));
el.aiDraftButton.addEventListener("click", () => generateAiDraft().catch(showFatal));
el.deleteCaseButton.addEventListener("click", () => deleteCurrentCase().catch(showFatal));
el.newCaseForm.addEventListener("submit", (event) => createCase(event).catch(showFatal));
el.cancelNewCaseButton.addEventListener("click", () => el.newCaseDialog.close());

el.markdownEditor.addEventListener("input", () => {
  state.content = el.markdownEditor.value;
  markDirty(state.content !== state.original);
  refreshPreview();
});

el.preview.addEventListener("input", (event) => {
  const block = event.target.closest?.("[data-segment-index]");
  if (!block || !el.preview.contains(block)) return;
  syncContentFromPreviewBlock(block);
});

el.saveButton.addEventListener("click", () => saveFile().catch(showFatal));

el.reloadButton.addEventListener("click", () => {
  refreshActiveCase().catch(showFatal);
});

el.tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
el.findNextButton.addEventListener("click", findNext);
el.replaceAllButton.addEventListener("click", replaceAll);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveFile().catch(showFatal);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

async function init() {
  setupPwaInstall();
  registerServiceWorker();
  await loadConfig();
  await loadCases();
  updateDocumentHead();
  setStatus("Bereit", "idle");
}

init().catch(showFatal);
