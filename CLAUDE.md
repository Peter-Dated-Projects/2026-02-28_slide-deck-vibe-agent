# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## SlideDeckVibeAgent

AI slide deck tool. User chats with LLM agent that edits slides in real time via Yjs CRDT.

**Stack:** Express + Bun (backend), React + Vite (frontend), Postgres, Redis, Minio (local) / GCP (prod).

**Runtime:** Bun (`bun install`, `bun add`, `bun run`). Tests: `bun test` or `bun run test` (Jest).

## Development Commands

**Root commands (run from project root):**
- `bun run dev` - Start entire ecosystem (Docker containers, backend, frontend)
- `bun run down` - Stop Docker containers
- `bun run build` - Build frontend for production
- `bun run typecheck` - Run TypeScript checks in backend
- `bun run test` - Run backend tests
- `bun run init:db` - Initialize database
- `bun run migrate:db` - Run database migrations

**Backend-specific commands (run from backend/):**
- `bun run dev` - Start backend in watch mode
- `bun run test` - Run Jest tests
- `bun run typecheck` - TypeScript type checking

**Frontend-specific commands (run from frontend/):**
- `bun run dev` - Start Vite dev server
- `bun run build` - Build for production
- `bun run preview` - Preview production build

## Architecture Overview

### CRDT-Based Real-Time Collaboration

The core innovation is real-time slide editing using Yjs CRDTs:

- **Y.Doc Structure**: Three main maps - `theme` (Y.Map), `slides` (Y.Array), `elements` (Y.Map)
- **AI Agent Integration**: Agent connects as WebSocket peer, all transactions tagged with `agent_id`
- **Persistence**: PostgreSQL-backed CRDT persistence with auto-compaction at 128 updates
- **Canvas Dimensions**: Fixed 1920x1080 pixel canvas with absolute positioning

### Backend Core Components

**DI Container (`src/core/container.ts`)**
- Dependency injection for database, storage, LLM, and cache services
- Environment-based provider selection (local vs production)
- Local: MinIO, Ollama/DashScope; Production: GCP, DashScope

**CRDT System (`src/core/crdt/`)**
- `schema.ts` - Y.Doc shape definitions and type interfaces
- `persistence.ts` - PostgreSQL CRDT storage with snapshot compaction
- `crdtTools.ts` - Atomic AI tools for slide manipulation
- `crdtExecutor.ts` - Applies tool calls as Y.Doc transactions
- `layout.ts` - Logical slot to pixel layout conversion

**Agent Orchestration (`src/services/agent.ts`)**
- LLM tool-call loop with CRDT context injection
- 12-turn conversation limit for safety
- Real-time event streaming to frontend

### Element Types and Canvas Layout

**Element Types:**
- `text` - HTML content with typography controls (levels h1-h3, body)
- `image` - URL-based images (never base64)
- `shape` - Geometric shapes with fill colors and border radius

**Layout Slots (1920x1080 canvas):**
- `title` - Full-width top (h=220, y=120)
- `heading` - Full-width header (h=180, y=120)
- `subtitle` - Full-width subheader (h=120, y=380)
- `body/content` - Main content area (h=680, y=300)
- `left/right` - Two-column layout (w=864 each)
- `image_left/image_right` - Large image placement (w=816, h=720)

### Frontend Architecture

**CRDT Integration (`src/components/CrdtCanvas.tsx`)**
- Connects to backend via `y-websocket`
- Local persistence via `y-indexeddb`
- Renders elements from flat CRDT map structure

**Real-Time Features:**
- WebSocket-based synchronization
- Awareness protocol for cursor/selection sharing
- Undo/Redo with "Undo AI" capability via `agent_id` tags

### Database Schema

Key tables:
- `users` - User authentication and profiles
- `projects` - Project metadata and ownership
- `conversations` - Chat history and context
- `crdt_documents` - Y.Doc snapshots
- `crdt_updates` - Incremental CRDT updates

### Storage Strategy

**Images**: URL strings only in CRDT, binary storage in MinIO/GCP
**Uploads**: POST /api/uploads → raw binary → storage → returns URL
**No Legacy**: Vibe V3 HTML deck engine fully removed

### Testing Strategy

**Backend Tests:**
- Infrastructure: `db.test.ts`, `storage.test.ts`
- LLM providers: `ollama-*`, `qwen-*` test files
- CRDT: `crdt/two-clients.ts`, `crdt/snapshot.ts` convergence tests

**CRDT Validation:**
- Two-client convergence testing
- Snapshot round-trip validation
- 128-update compaction boundary testing

### Authentication & Security

**JWT Strategy:** Hybrid access tokens + HttpOnly refresh rotation
**WebSocket Auth:** JWT-based connection authorization per project
**Content Isolation:** AI-generated content served from isolated origins
**Agent Safety:** Recursive tool-call limits, "Denial of Wallet" protection

### Environment Configuration

**Required .env files:**
- `.env.local` - Local development
- `.env.production` - Production deployment
- `.env.staging` - Staging environment
- `.env.test` - Test environment

**Key Variables:**
- Database: PostgreSQL connection details
- Storage: MinIO (local) / GCP (production)
- LLM: DashScope API key or Ollama endpoint
- Redis: Cache connection string

### Important Development Notes

**CRDT Operations:**
- Always call `read_presentation()` before structural changes
- Create slides with `create_slide()` before adding elements
- Use `add_element()`, `update_element()`, `delete_element()` for content
- Keep task checklist current with `create_tasks()` and `update_task_status()`

**Image Handling:**
- Never store images as base64 in CRDT
- Always use URLs pointing to MinIO/GCP storage
- Upload via POST /api/uploads endpoint

**Agent Development:**
- 1920x1080 canvas with 96px margins
- All positioning is absolute pixel coordinates
- Font support includes system fonts + Google Fonts subset
- Agent connects as WebSocket peer for real-time collaboration