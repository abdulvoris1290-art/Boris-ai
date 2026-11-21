# Voris AI

**Intelligence, without limits.** A premium, full-stack AI assistant platform: streaming chat, writing and coding tools, document and image understanding, web search, voice, translation, accounts, and persistent history.

---

## Quick start

Requires **Node.js 22.18+** (it uses the built-in `node:sqlite` and runs TypeScript natively, so there's no build step for the server).

```bash
npm install
npm run setup               # pick a provider, paste your key; it tests the connection
npm run dev                 # web on http://localhost:5173, API on :3001
```

Production:

```bash
npm run build               # typechecks client + server, bundles the frontend into dist/
NODE_ENV=production npm start   # serves the API and the built app on PORT (default 3001)
```

Run it behind HTTPS in production (a reverse proxy such as Caddy or Nginx). Set `APP_ORIGIN` to your public URL.

---

## Connecting an AI provider

The quickest way is `npm run setup`: it asks for your provider and keys, writes `.env`, and makes a real test call. Run `npm run doctor` at any time to re-check the chat model, image model and web search.

All credentials live in `.env` on the server. They are **never** sent to the browser. Until a provider is configured, the app shows a clear "AI provider not connected" notice and sending is disabled.

| Provider | `.env` | Default model |
|---|---|---|
| **Anthropic (Claude)** | `AI_PROVIDER=anthropic`<br>`AI_API_KEY=sk-ant-...` | `claude-opus-5-5` |
| OpenAI | `AI_PROVIDER=openai`<br>`AI_API_KEY=sk-...` | `gpt-4.1-mini` |
| **Groq** (free tier) | `AI_PROVIDER=groq`<br>`AI_API_KEY=gsk_...` | `openai/gpt-oss-120b` (images: `qwen/qwen3.8-27b`, up to 3 per message) |
| OpenRouter | `AI_PROVIDER=openrouter`<br>`AI_API_KEY=sk-or-...` | `openrouter/auto` |
| Any OpenAI-compatible API (Ollama, vLLM, LM Studio, Together…) | `AI_PROVIDER=custom`<br>`AI_BASE_URL=http://localhost:11434/v1`<br>`AI_MODEL=llama3.1` | — |

Optional settings:

- `AI_MODEL`: override the default model.
- `AI_VISION_MODEL`: model used for messages that include images. Image upload is turned off when no vision model is available.
- `AI_EFFORT` (Anthropic only): `low` | `medium` | `high` | `xhigh` | `max`.

Groq retires models from time to time ([deprecations](https://console.groq.com/docs/deprecations)). If `npm run doctor` reports a missing model, set `AI_MODEL` / `AI_VISION_MODEL` to a current one from [Groq's model list](https://console.groq.com/docs/models). Reasoning output from models like gpt-oss and Qwen is hidden automatically.

On Claude models that support it, the Anthropic provider turns on server-side refusal fallbacks (`fallbacks: "default"`). The OpenAI-model defaults above may change over time; set `AI_MODEL` to pin one.

### Web search (optional)

```env
SEARCH_PROVIDER=tavily   # or: brave
SEARCH_API_KEY=...
```

When this is configured, a **Web search** toggle appears in the composer's **+** menu. Answers then cite their sources with numbered links like [1].

---

## Features

**Chat**
- Real-time streaming responses (Server-Sent Events) with a Stop button (or press `Esc`). A stopped reply keeps the text generated so far.
- Regenerate, edit and resend, copy, read aloud, and clear the conversation.
- Markdown with GFM tables, syntax-highlighted code blocks with Copy and line wrap, and clickable citations.
- The AI names each new conversation automatically. You can also rename, pin, delete, search (titles and message content), and export conversations as Markdown.
- Responds in the user's language (English, Uzbek, Russian, German and more), or always in a language you choose.

**Tools** (in the composer's **+** menu)
- **Writing**, **Coding** and **Translate** modes. Each adds a specialized system prompt; Translate lets you pick the target language.
- **Documents:** PDF (text is extracted in the browser) plus text and code files. Add them with the **+** menu, drag and drop, or a suggestion card.
- **Images:** upload, paste or drop images and ask questions about them. Images are resized in the browser before upload.
- **Web search** (when configured).
- **Voice:** speech-to-text input and read-aloud, through the browser's Web Speech API (Chrome, Edge and Safari support input). Ask by voice and the answer is read back to you (can be turned off in Settings → Voice). The microphone needs HTTPS or `localhost`.

**Accounts and settings**
- Private by default: the first account you create is the owner, and sign-up then closes so nobody else can use your API keys. Set `ALLOW_SIGNUP=true` in `.env` to allow more accounts.
- Sign up, sign in and sign out. Passwords are hashed with scrypt. Sessions use random tokens, stored hashed, in HTTP-only SameSite cookies with sliding expiry.
- Settings: theme (dark, light or system), response language, Enter-to-send, smart titles, custom instructions, voice language, change name or password, sign out other devices, export all data (JSON), delete all chats, delete account.
- Keyboard shortcuts: `Ctrl/⌘+K` search, `Ctrl/⌘+Shift+O` new chat, `Ctrl/⌘+B` toggle sidebar, `Ctrl/⌘+,` settings, `/` focus the composer, `Esc` stop.

**Security**
- AI and search keys stay on the server.
- State-changing requests are checked for Origin (CSRF protection) and must be JSON.
- Per-IP rate limits on authentication and per-user rate limits on AI requests.
- All input is validated on the server, attachments are size-checked, and every chat query is scoped to its owner.
- In production the server sends a strict Content-Security-Policy, HSTS and anti-framing headers.

---

## Project structure

```
server/                 Node + Express 5 API (TypeScript, run natively by Node)
  index.ts              App, security headers, CSRF check, static hosting
  config.ts             Environment configuration
  db.ts                 SQLite schema (users, sessions, chats, messages)
  auth.ts               Password hashing, sessions, preferences
  prompts.ts            System prompt, tool modes, language handling
  search.ts             Tavily / Brave web search
  providers/            AI provider layer (Anthropic SDK, OpenAI-compatible)
  routes/auth.ts        Sign up, login, profile, password, account deletion
  routes/chats.ts       Chat CRUD, search, export, streaming completions
scripts/setup.ts        `npm run setup` / `npm run doctor`: guided .env setup and live connection checks
src/                    React 19 + TypeScript frontend (Vite)
  store/                Zustand stores (auth, chats/streaming, ui/theme)
  lib/                  API client and SSE parser, file processing, speech
  components/           auth, layout (shell, sidebar), chat, settings, ui
  styles/               Design system (tokens, components, chat)
```

### Adding a new AI provider
Implement the `AIProvider` interface in `server/providers/types.ts` (`stream` and `complete`), then register it in `server/providers/index.ts`.

### Adding a new tool mode
Add the mode to `MODES` and `MODE_INSTRUCTIONS` in `server/prompts.ts`, add it to the `Mode` type in `src/lib/types.ts`, and add an entry to `MODE_META` and the **+** menu in `src/components/chat/Composer.tsx`.

---

## Data

Data is stored in a SQLite file, `./data/voris.db` by default (`DATABASE_PATH`). Back it up like any other database file. For multi-instance deployments, move to Postgres. The data access is limited to `server/db.ts` and the route files.
