# Anamnese Editor PWA

Installierbare Netlify-PWA zum Bearbeiten von Markdown-Anamneseberichten. Die App lädt Fallordner aus einem privaten GitHub-Content-Repo und speichert Änderungen über Netlify Functions als GitHub-Commits.

## Struktur

- `public/`: statische Oberfläche, Manifest und Service Worker
- `netlify/functions/`: API-Routen fuer GitHub Contents API
- `scripts/import-cases.mjs`: Import lokaler Markdown-Fälle in die Content-Repo-Struktur
- `scripts/build.mjs`: kopiert `public/` nach `dist/`

## Environment Variables

Diese Werte werden in Netlify gesetzt und nicht ins Frontend ausgeliefert:

```text
GITHUB_OWNER=<github-user-oder-org>
GITHUB_REPO=beratung-markdown-content
GITHUB_BRANCH=main
GITHUB_TOKEN=<token-mit-zugriff-auf-content-repo>
CONTENT_ROOT=cases
OPENAI_API_KEY=<serverseitiger-openai-api-key>
OPENAI_MODEL=gpt-5.4-mini
```

## Entwicklung

```bash
npm install
npm run build
npm run dev
```

Für lokale Function-Tests eine `.env` nach `.env.example` anlegen. Den Token nie committen.

## Arbeitsablauf

- `Neuer Fall` legt `anamnesekonzept.md`, `rohdaten.md` und `meta.json` im Content-Repo an.
- `Codex-Briefing` erzeugt oder aktualisiert `codex-briefing.md` fuer den aktiven Fall.
- `KI-Entwurf` erstellt nur einen ungespeicherten Entwurf im Editor.

## Import

```bash
node scripts/import-cases.mjs
```

Standardquelle ist `E:\001 MYCELIUM\001 BERATUNG`, Standardziel ist `..\beratung-markdown-content\cases`.
