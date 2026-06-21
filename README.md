# Session Search

Session Search is an OpenClaw Control UI plugin for finding, inspecting, injecting, and resuming prior sessions.

It is intended for OpenClaw builds that support Plugin UI Entry Points, gateway-authenticated plugin HTTP routes, session transcript access, and the `before_prompt_build` plugin hook.

The current example targets OpenClaw builds containing the Plugin UI Entry Points dispatch fix from `openclaw/openclaw#80388`, verified against the 2026.6.8 PR stack used for Windows gateway testing. Older compatible builds should work only when they preserve the required host APIs below.

## Installation

This repository contains only the Session Search plugin files. The published example includes a built `dist/index.js` so it can be copied into a local plugin directory without an OpenClaw source tree.

Example local-plugin install:

```bash
mkdir -p ~/.openclaw/workspace/local-plugins/session-search
cp -a /path/to/session-search-plugin/. ~/.openclaw/workspace/local-plugins/session-search/
```

Then enable `session-search` from that local plugin path and restart the gateway.

Example source-checkout install:

```bash
cd /path/to/openclaw
mkdir -p extensions/session-search
cp -a /path/to/session-search-plugin/. extensions/session-search/
corepack pnpm install
corepack pnpm build
```

Then start or restart the OpenClaw gateway from that rebuilt checkout.

Local plugin installs load `dist/index.js`. Source-checkout development can still use `index.ts` before rebuilding the package.

## Requirements

- An OpenClaw build with Plugin UI Entry Points support.
- Plugin SDK support for `api.session.controls.registerControlUiEntryPoint`.
- Gateway dispatch registration for `plugins.uiEntryPoints` and `plugins.uiEntryPointLaunch`.
- Gateway-authenticated plugin HTTP routes.
- The `before_prompt_build` plugin hook.
- Session store and transcript runtime APIs.
- Workspace bootstrap and memory-file conventions.

Older OpenClaw releases that do not include these host APIs will need the Plugin UI Entry Points core changes first.

## Features

- Adds a `Session Search` entry to the Control UI app navigation.
- Searches across all configured agents, with an agent filter when needed.
- Searches indexed and discovered session transcripts from the configured session store.
- Supports exact, all-words, and any-word search matching.
- Filters search by user, assistant, tool, system, and other message roles.
- Opens a session detail view with transcript metadata and message text.
- Shows an entire source session to the active agent with `Show Session to Agent`.
- Shows only selected messages to the active agent with `Show Selected Messages to Agent`.
- Marks gaps between non-consecutive selected messages so the receiving agent knows intervening messages existed.
- Clears selected messages when leaving a session detail view or switching sessions.
- Resumes a whole source session into a newly created OpenClaw session.
- Resumes from a specific message with `Resume Session from Here`, including only the source transcript up to and including that message.
- Blocks resume operations that exceed the active context window and shows `Session exceeds the active context window.` without creating or injecting a new session.

## Resume Behavior

Resume creates a new OpenClaw session and queues historical context for that new session's next prompt. It does not resurrect the original runtime state, shell sessions, browser state, hidden prompt bundle, or unsurfaced tool state.

Resume context includes:

- A resume manifest with source session key, id, title, channel, status, model/provider, timestamps, parent session key when present, source date anchor, and transcript count.
- The source transcript text, wrapped as historical conversation context.
- Daily memory files anchored to the source session date, not the current date. For example, a session dated May 24 includes the May 24 and May 23 daily memory files when they exist.
- Current workspace bootstrap markdown files that normal sessions would load. These are current file contents, not historical snapshots.

Resume from Here uses the same context model, but truncates the source transcript at the selected message.

## Agent Injection Behavior

`Show Session to Agent` and `Show Selected Messages to Agent` do not create a new session. They queue context for the currently active session and then return the user to chat.

These injection paths are intentionally transcript-focused:

- Full-session injection includes the source transcript.
- Selected-message injection includes only the selected transcript messages.
- Non-consecutive selected messages receive an omitted-message marker between included messages.
- Resume-only manifest and workspace file context are not included in these direct injection actions.

## Security Model

- Plugin pages are served through gateway-authenticated routes.
- The Control UI entry point opens in-app and requires `operator.read`.
- Entry-point launch tokens and follow-up iframe sessions are scoped to the entry point's `requiredScopes`.
- Browser requests send session keys and message indexes; transcript text is reread on the server.
- Resume and injection payloads are assembled server-side.
- The plugin does not call external services.

## Compatibility

Compatibility proof as of June 21, 2026:

- The plugin loaded on the Windows gateway after copying the built local-plugin bundle into `local-plugins/session-search`.
- `/plugins/session-search/` returned an authenticated `401`, proving the plugin route was registered.
- The gateway log showed `session-search` in the loaded plugin set and `plugins.uiEntryPoints` succeeded.

This plugin is designed as an OpenClaw workspace/bundled extension. It imports OpenClaw plugin runtime helpers and expects a compatible OpenClaw build with:

- `api.session.controls.registerControlUiEntryPoint`
- `plugins.uiEntryPoints` and `plugins.uiEntryPointLaunch` registered through the gateway core dispatch map
- gateway-authenticated plugin HTTP routes
- `before_prompt_build`
- session store and transcript runtime APIs
- workspace bootstrap and memory file conventions

It is not currently packaged as a standalone npm plugin for older OpenClaw releases. Use the built local-plugin copy or install it inside a compatible OpenClaw source checkout.

## Development

Focused test:

```bash
cd /path/to/openclaw
node scripts/run-vitest.mjs run --config test/vitest/vitest.extensions.config.ts extensions/session-search/index.test.ts
```

Lint:

```bash
cd /path/to/openclaw
node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.extensions.json extensions/session-search
```

Format:

```bash
cd /path/to/openclaw
corepack pnpm exec oxfmt --write --threads=1 extensions/session-search
```

The running gateway executes built files from `dist`, so source changes must be rebuilt before testing through a live gateway.

Bundle for local plugin installs:

```bash
cd /path/to/openclaw
node_modules/.bin/esbuild extensions/session-search/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --outfile=extensions/session-search/dist/index.js \
  --external:openclaw/plugin-sdk/*
```
