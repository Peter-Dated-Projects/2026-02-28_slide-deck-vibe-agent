# SlideDeckVibeAgent

AI slide deck tool. User chats with LLM agent that edits slides in real time via Yjs CRDT.

**Stack:** Express + Bun (backend), React + Vite (frontend), Postgres, Redis, Minio (local) / GCP (prod).

**Runtime:** Bun (`bun install`, `bun add`, `bun run`). Tests: `bun test` or `bun run test` (Jest).

---

## Root

- `docker-compose.yml` — local Postgres + Redis + Minio
- `db/init.sql` — schema (users, projects, `crdt_documents`, `crdt_updates`)
- `.env.local` / `.env.production` / `.env.staging` / `.env.test` — env configs
- `DESIGN.md`, `README.md` — docs

---

## Backend (`backend/`)

- `main.ts` — Express + HTTP server bootstrap, mounts WS upgrade handler

### `src/config/`
- `index.ts` — env var loader

### `src/middleware/`
- `auth.ts` — JWT auth middleware

### `src/controllers/`
- `auth.ts` — login / signup / Google OAuth
- `user.ts` — user profile endpoints
- `project.ts` — project CRUD

### `src/routes/`
- `crdtWebsocket.ts` — Yjs sync + awareness over `ws`, JWT auth, per-project doc cache
- `uploads.ts` — `POST /api/uploads` raw binary → Minio → returns URL

### `src/services/`
- `agent.ts` — LLM agent orchestration; runs tool-call loop, connects as WS peer
- `contextManager.ts` — builds prompt context from CRDT doc state
- `projectDeck.ts` — project/deck DB ops
- `previewRenderer.worker.cjs` — slide thumbnail renderer worker

### `src/core/`
- `container.ts` — DI container (wires providers to interfaces)
- `messageSanitizer.ts` — strips/cleans LLM message content
- `agentTypes.ts` — shared agent type defs

### `src/core/crdt/`
- `schema.ts` — Y.Doc shape helpers (theme, slides, elements)
- `persistence.ts` — `PgCrdtPersistence`: load/append/snapshot (compacts at 128 updates)
- `docManager.ts` — per-project Y.Doc cache and lifecycle
- `crdtTools.ts` — atomic AI tools (`add_element`, `update_element`, `delete_element`, etc.)
- `crdtExecutor.ts` — applies tool calls as Y.Doc transactions tagged with `agent_id`
- `layout.ts` — logical-slot → pixel layout engine

### `src/core/interfaces/`
- `ICacheService.ts`, `IDatabaseService.ts`, `ILLMService.ts`, `IStorageService.ts` — provider contracts

### `src/infrastructure/providers/`
- `cache/RedisCacheProvider.ts`
- `db/PgDatabaseProvider.ts`
- `llm/GemmaProvider.ts`, `llm/QwenProvider.ts`, `llm/toolCallParser.ts`
- `storage/MinioProvider.ts`, `storage/GCPStorageProvider.ts`

### `scripts/`
- `init-db.ts`, `manage-db.ts`, `migrate-db.ts`, `migrate.js`, `check-db.ts` — DB lifecycle
- `sync-s3-users.ts` — user storage sync
- `crdt/two-clients.ts` — CRDT convergence test
- `crdt/snapshot.ts` — snapshot round-trip test

### `src/tests/`
- `db.test.ts`, `storage.test.ts` — infra integration
- `ollama-*`, `qwen-*` — LLM provider tests
- `core/messageSanitizer.test.ts`, `core/toolCallParser.test.ts`

---

## Frontend (`frontend/`)

- `vite.config.ts`, `tailwind.config.cjs`, `tsconfig.json` — build config
- `index.html`, `src/main.tsx`, `src/App.tsx` — entry

### `src/api/`
- `index.ts` — backend HTTP client

### `src/contexts/`
- `AuthContext.tsx` — auth state + JWT

### `src/hooks/`
- `usePersistentWidth.ts` — localStorage-backed sidebar width

### `src/lib/`
- `conversationActivity.ts` — chat activity helpers
- `gemmaOutputParser.ts` — parses streaming Gemma tool calls

### `src/components/`
- `CrdtCanvas.tsx` — Yjs canvas: `y-indexeddb` + `y-websocket`, renders elements from flat map
- `GoogleAuthWrapper.tsx` — Google OAuth provider
- `chat/ChatMessage.tsx`, `chat/TaskListBar.tsx`
- `dashboard/ProjectCard.tsx`, `dashboard/TemplateCard.tsx`
- `layout/DashboardLayout.tsx`, `layout/Sidebar.tsx`

### `src/pages/`
- `LoginPage.tsx`, `SetupProfilePage.tsx`, `ChatPage.tsx`
- `dashboard/ProjectsPage.tsx`, `dashboard/ProfilePage.tsx`, `dashboard/SettingsPage.tsx`

---

## Architecture Notes

- CRDT: flat `theme` Y.Map + `slides` Y.Array + `elements` Y.Map, all `Y.Doc({ gc: true })`
- AI agent connects as a WS peer; every txn tagged with `agent_id` for "Undo AI"
- Images: URL strings only in CRDT, never bytes/base64
- Snapshot threshold: 128 updates → auto-compact
- No legacy HTML deck engine (Vibe V3 fully removed)
