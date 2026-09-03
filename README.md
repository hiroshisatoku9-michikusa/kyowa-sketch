# Kyowa Sketch

Kyowa Sketch is a local Codex-powered prototype of a co-speech AI interface. It separates two actions that normal chat UIs collapse into one:

- making unfinished words visible to another mind
- handing over the turn as a completed message

There is no Send button. As you type, the app waits 3 seconds, then asks Codex for one to three weak, provisional readings of the draft so far. They appear as faint ghost co-speech between your own lines, close enough to ignore by simply continuing to write.

The default interface and reading language is English. Use the compact language switch in the header to move between English and Japanese; the selected language is saved locally and sent with each reading request.

## Run Locally

This repo has no npm dependencies. It uses the built-in Node.js HTTP server and a local `codex app-server` process.

First, install Codex and sign in with ChatGPT:

```bash
codex
```

Then start Kyowa Sketch:

```bash
npm start
```

Open:

```text
http://localhost:8787
```

You can also change the port:

```bash
PORT=3000 npm start
```

For a short blurb to paste alongside a GitHub URL, see [SHARE_TEXT.md](./SHARE_TEXT.md).

## No API Key Required

The app does not use `OPENAI_API_KEY`. Instead, the local server starts Codex app-server and uses your existing Codex/ChatGPT login. That makes this a Codex-required local app, not a pure static website.

If `codex` is not on your `PATH`, set `CODEX_BIN`:

```bash
CODEX_BIN="/Applications/ChatGPT.app/Contents/Resources/codex" npm start
```

## Usage Controls

The prototype is intentionally conservative:

- default model: `gpt-5.6-luna`
- default reasoning effort: `none`
- browser debounce: `3` seconds
- server-side minimum between reads: `3` seconds
- minimum text change before another read: `18` characters
- default language: English, with a local English/Japanese switch
- maximum draft sent per read: `1800` characters
- maximum streamed output before interrupt: `520` characters
- daily read cap: `60` reads
- daily token cap: `650000` tokens
- one short ephemeral Codex thread per reading, so history does not accumulate
- read-only sandbox and no network access for each reading turn
- visible request and token counters

Codex app-server currently carries a noticeable fixed prompt overhead per reading, so the app treats this as a local interface experiment rather than an always-on production surface. Use the AI toggle when you want to pause readings.

## Security Notes

See [SECURITY.md](./SECURITY.md) before publishing a fork. The short version: do not commit `.env`, keep the server bound to `127.0.0.1`, and remember that draft text is sent to Codex through the signed-in user's account after the debounce interval.

## Configuration

Optional environment variables:

```bash
KYOWA_CODEX_MODEL=gpt-5.6-luna
KYOWA_CODEX_EFFORT=none
KYOWA_MAX_DRAFT_CHARS=1800
KYOWA_MAX_OUTPUT_CHARS=520
KYOWA_MIN_CHANGED_CHARS=18
KYOWA_MIN_SECONDS_BETWEEN_REQUESTS=3
KYOWA_MAX_READS_PER_DAY=60
KYOWA_MAX_TOKENS_PER_DAY=650000
```

## Design Notes

The interface follows four constraints from the essay:

- readings should be early, but not interruptive
- readings should be specific, but weak
- refusal should be cheap
- nothing should become a message until the writer decides it has settled

That is why the page uses low-contrast ghost lines, short question-like readings, cheap pinning, and no autocomplete.

## Thinking Session Adaptation

This prototype borrows three product ideas from the Thinking Session frame:

- a continuously updating draft stream and a separate AI stream
- user-owned markers for fragments that should remain available
- explicit settling later, rather than silently turning every AI reading into direction

It does not adopt the observer/analyzer frame. In Kyowa Sketch, AI is a weak participant in the conversation: it offers small utterances that the writer can keep, write through, or let pass.
