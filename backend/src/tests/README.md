# Backend Integration Tests

This folder contains both unit tests (run via Jest) and **integration test scripts** (run directly with `bun`).

## Integration Tests

Integration tests make **real API calls** and are meant to be run manually to verify provider connectivity. They are **not** part of the Jest suite.

### Requirements

All integration tests must be run using the `.env.test` environment. Ensure your `.env.test` file at the project root contains the relevant keys:

- `QWEN_API_KEY` — for Qwen tests
- `OLLAMA_BASE_URL` — for Ollama tests (defaults to `http://localhost:11434`)

### Running the Tests

From the `backend/` directory:

```bash
# Run all integration tests (must end in .integration.test.ts)
bun test integration

# Or run them individually:

# Qwen
NODE_ENV=test bun test src/tests/qwen-conversation.integration.test.ts
NODE_ENV=test bun test src/tests/qwen-tools.integration.test.ts

# Ollama (requires a running local Ollama instance)
NODE_ENV=test bun test src/tests/ollama-conversation.integration.test.ts
NODE_ENV=test bun test src/tests/ollama-tools.integration.test.ts
```

### What Each Test Does

| Script | Provider | What it tests |
|---|---|---|
| `qwen-conversation.integration.ts` | Qwen | 3-turn conversation loop, verifies API connectivity |
| `qwen-tools.integration.ts` | Qwen | Dummy tool call, verifies tool-calling capability |
| `ollama-conversation.integration.ts` | Ollama | 3-turn conversation loop, verifies local API connectivity |
| `ollama-tools.integration.ts` | Ollama | Dummy tool call, verifies tool-calling capability |

### Notes

- Tool tests use a one-time dummy tool (`echo_test`) defined locally in the test file. It is not a real production tool.
- Conversation tests do **not** validate the content of responses, only that the connection succeeds and a non-empty reply is returned.
