# SlideDeckVibeAgent — Project Context

## What This Project Is

An AI-powered slide deck creation tool. Users chat with an LLM agent that generates and edits presentation slides in real-time. The backend runs on Express + Bun, frontend on React, storage on Minio (local) / GCP (prod), PostgreSQL for metadata, Redis for caching.

---

## Active Migration: Vibe V3 → CRDT Engine

This project is mid-migration from a legacy centralized HTML-based slide engine to a real-time collaborative CRDT system (Yjs).

**Reference document:** Gemini-generated execution plan attached in the session that initiated this migration.

### Why

The old engine (Vibe V3) stored each presentation as a single HTML file in Minio, with slides delimited by `<!-- VIBE_SLIDE_ID:... -->` HTML comments and a manifest embedded in a `<script>` block. The AI emitted whole-document HTML replacements guarded by SHA256 optimistic concurrency control (OCC). There was no real-time sync — only REST + SSE. No concurrent editing was possible.

### Target Architecture

- **CRDT (Yjs):** flat document structure — `theme` Y.Map, `slides` Y.Array (ordered IDs), `elements` Y.Map (flat map of ElementID → Y.Map)
- **WebSocket sync:** all clients (human + AI) connect as peers via `/ws/presentation/:projectId?token=<jwt>`
- **Persistence:** binary CRDT snapshots in Postgres (`crdt_documents.doc_state BYTEA`), incremental updates in append log (`crdt_updates`) with `agent_id` tagging for "Undo AI" rollback
- **Images:** uploaded via `POST /api/uploads` (binary body → Minio → signed URL); only the URL string is stored in the CRDT elements map — never raw bytes or base64
- **Memory:** every `Y.Doc` constructed with `{ gc: true }` to garbage-collect tombstones
- **Offline:** frontend uses `y-indexeddb` alongside `y-websocket` (Phase 2)
- **AI tools:** replaced with atomic mutations — `add_element`, `update_element`, `delete_element`, etc. (Phase 3)

### No Backwards Compatibility

The database will be reset. No legacy adapter or batch migration. Existing Vibe V3 deck HTML files are discarded.

---

## Migration Phase Status

| Phase | Description | Status |
|---|---|---|
| **Phase 1** | Foundation & Infrastructure (DB tables, WS server, persistence, uploads) | **Complete** |
| **Phase 2** | Core Renderer — `CrdtCanvas.tsx` with `y-indexeddb` + connection indicator | **Complete** |
| Phase 3 | AI Tool Redesign — atomic CRDT mutations replacing all 21 legacy tools | Pending |
| Phase 4 | Hard Cutover — delete legacy code (`tools.ts`, `vibeManager.ts`, `SlideRenderer.tsx`, etc.), reset DB | Pending |

---

## Phase 1 — What Was Built

**New files:**
- [db/init.sql](db/init.sql) — added `crdt_documents` + `crdt_updates` tables (legacy columns kept until Phase 4)
- [backend/src/core/crdt/schema.ts](backend/src/core/crdt/schema.ts) — Y.Doc shape helpers (`createDoc`, `getTheme`, `getSlides`, `getElements`, `readElement`)
- [backend/src/core/crdt/persistence.ts](backend/src/core/crdt/persistence.ts) — `PgCrdtPersistence`: load (replay snapshot + updates), appendUpdate, snapshot (compacts log at 128 updates), maybeSnapshot
- [backend/src/routes/crdtWebsocket.ts](backend/src/routes/crdtWebsocket.ts) — Yjs sync + awareness over `ws`, JWT auth on upgrade, per-project doc cache, broadcasts, origin-tagged persistence
- [backend/src/routes/uploads.ts](backend/src/routes/uploads.ts) — `POST /api/uploads` raw binary upload → Minio → `{ url, key, contentType, size }`
- [backend/scripts/crdt/two-clients.ts](backend/scripts/crdt/two-clients.ts) — convergence validation script
- [backend/scripts/crdt/snapshot.ts](backend/scripts/crdt/snapshot.ts) — snapshot round-trip validation script

**Modified:**
- [backend/main.ts](backend/main.ts) — switched from `app.listen` to `http.createServer` + `mountCrdtWebsocket`; registered `uploadsRouter`

**Dependencies added (bun add):**
`yjs`, `y-protocols`, `ws`, `lib0`, `@types/ws`

---

## Key Architecture Decisions (Made This Session)

- **Yjs over Automerge** — mature `y-websocket` ecosystem, smaller payloads, better server story for Express
- **No feature flag** — hard cutover; legacy runs until Phase 4 PR deletes it
- **Agent as peer WS client** — AI connects to its own `WebsocketProvider` per session; every transaction tagged with `agent_id`
- **Deterministic layout engine** — AI emits logical intent (slot / after), server computes `(x, y, w, h)` via `backend/src/core/crdt/layout.ts` (to be built in Phase 2)
- **Images via URL only** — CRDT elements hold `content.url` strings, never binary data
- **`gc: true` everywhere** — prevents tombstone memory bloat in long sessions
- **Snapshot threshold: 128 updates** — triggers automatic compaction

---

## Tooling Rules

- **Package manager / runtime: Bun** — `bun install`, `bun add`, `bun run`, `bun <file>`
- Backend is Express (not `Bun.serve()`) — existing codebase pre-dates the CLAUDE.md Bun-native guidance; follow existing patterns
- Database: Postgres via `pg` (not `Bun.sql`)
- Cache: Redis via `redis` package (not `Bun.redis`)
- WebSocket: `ws` package alongside Express HTTP server (WS upgrade handler on the same port)
- Tests: `bun test` for bun-native tests; legacy tests use Jest (`bun run test`)

---

## Phase 2 Next Steps

1. Install `y-indexeddb` in frontend
2. Create `frontend/src/components/CrdtCanvas.tsx`:
   - `new Y.Doc({ gc: true })`
   - `IndexeddbPersistence(projectId, doc)` first (offline support)
   - `WebsocketProvider(WS_URL, projectId, doc)`
   - Renders elements from flat map; images via `<img src={content.url}>`
   - Connection state indicator badge driven by `WebsocketProvider.on('status', ...)`
3. Create `backend/src/core/crdt/layout.ts` — logical-slot → pixel layout engine
4. Wire `ChatPage.tsx` to mount `CrdtCanvas` instead of legacy `SlideRenderer`
5. Delete `frontend/src/components/SlideRenderer.tsx` and `frontend/src/lib/layoutExtractor.ts`
