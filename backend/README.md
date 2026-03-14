# backend

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run 
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Redis Deck Cache

- Deck HTML is cached in Redis with a 5-minute idle TTL (`REDIS_TTL_SECONDS`, default `300`).
- On project open (`GET /api/presentation/:conversationId`), backend loads deck HTML from cache or S3 and refreshes TTL.
- Agent reads and edits the same S3-backed HTML file; successful write tools persist back to S3 and refresh Redis cache.
