# Security

Kyowa Sketch is designed as a local-only Codex experiment.

## What Is Safe To Share

- No `OPENAI_API_KEY` is required.
- The browser never receives an OpenAI API key.
- `/api/status` returns only the account type and plan type, not the signed-in email.
- The HTTP server binds to `127.0.0.1` by default.
- Codex reading turns run with read-only sandboxing and no network access.
- Local drafts, kept fragments, and traces are stored in browser `localStorage`.

## What Still Leaves The Machine

Draft text is sent to Codex through the signed-in user's local Codex/ChatGPT account after the debounce interval. Do not type passwords, private keys, access tokens, or confidential third-party data into the draft area unless you are comfortable sending that text to the model.

## Before Publishing A Fork

- Do not commit `.env`.
- Do not change the server bind address from `127.0.0.1` to a public interface unless you add authentication and CSRF protection.
- Keep `approvalPolicy: "never"` and the read-only, no-network sandbox settings for reading turns.
- Run `npm run check`.
- Run the focused secret smoke check before pushing:

```bash
npm run security:check
```

## Reporting Issues

Open a GitHub issue with a short reproduction, your OS, Codex version, and whether the issue happened before or after a reading request.
