# Vibe Slide: Web-Native Presentation Engine

Vibe Slide is a full-stack, AI-powered platform that transforms creative "vibes" into interactive, responsive, website-style slide decks. Designed for the modern era of storytelling, it moves beyond static PDFs into dynamic web experiences that are responsive, shareable, and living.

## 🚀 Core Vision

To bridge the gap between creative intent and professional web design. Users provide a high-level "vibe" (theme, tone, content), and our Agentic Workflow handles the design tokens, layout selection, and component generation to deliver a live, shareable URL.

## 🏗️ Architecture & Tech Stack

The project follows a "Cloud-Native Local" philosophy, ensuring that the development environment perfectly mirrors production.

* **Frontend:** Next.js (React) + Tailwind CSS + Framer Motion.
* **Backend:** Node.js (Bun) + Express + Anthropic (Claude 3.5 Sonnet).
* **Database:** PostgreSQL (User data, conversation history, and billing).
* **Storage:** MinIO / S3 (Storage for generated web-site "mini-folders").
* **Orchestration:** Docker Compose with hot-reloading (HMR) for both frontend and backend.

## 🔒 Security & Stewardship

As professional software stewards, we prioritize the integrity and privacy of user data. We view the protection of user information not just as a compliance requirement, but as a commitment to trust and service.

* **Authentication:** Hybrid JWT Access Tokens + `HttpOnly` Refresh Token rotation.
* **Sandboxing:** AI-generated content is served from isolated origins to prevent XSS and session hijacking.
* **Agentic Constraints:** Recursive tool-calls are strictly capped to prevent "Denial of Wallet" and ensure predictable, ethical behavior.
* **Integrity:** Direct database access is gated through strict tool-based interfaces to prevent unauthorized data exposure.

## 🛠️ Getting Started

### Prerequisites

* Docker & Docker Compose
* Node.js (LTS)
* Anthropic API Key

### Installation

1. Clone the repository.
2. Create a `.env.local` file in the root based on the provided template.
3. Start the entire ecosystem: