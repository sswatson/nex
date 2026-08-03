# Nex

A localhost app for self-directed learning through chat. A lesson is a script — Markdown exposition with embedded questions — delivered verbatim one message at a time. The learner can go off-script at any point by typing a question; an LLM tutor (with the whole lesson as context) answers and steers them back.

A modern re-imagining of [Prismia](https://prismia.chat)'s self-paced shared lessons.

## How it works

- **Exposition** is delivered word-for-word from the lesson file — no LLM call, instant and faithful to the author.
- **Multiple-choice questions** are graded deterministically, with per-choice explanations.
- **Free-response questions** are graded by the LLM against author-provided criteria (correct / partial / incorrect, with feedback). Clarifying questions asked mid-question are detected and answered without closing the question.
- **Open-ended questions** get a thoughtful LLM reply — no right answer.
- **Coding exercises** open a folder that ships with the lesson in your own editor or multiplexer (see below) — the app stays a chat, your tools stay your tools.
- **Off-script questions** (anything typed when no text question is pending) stream back an answer from the tutor, which knows the full script and the learner's position in it.
- Progress and chat history persist server-side in SQLite (`~/.local/share/nex/history.db`), so they survive browser data loss. Each pass through a lesson is a row in `runs`; **Start afresh** archives the current run (never deletes) and begins a clean one. To recover an old run:

  ```sh
  sqlite3 ~/.local/share/nex/history.db "SELECT id, slug, archived_at FROM runs"
  # make an archived run current again (start afresh first so the slot is free):
  sqlite3 ~/.local/share/nex/history.db "UPDATE runs SET archived_at = NULL WHERE id = 42"
  ```

## Setup

Requires Node 24 (pinned via [volta](https://volta.sh) in `package.json`).

```sh
pnpm install
pnpm dev
```

### Global install

To launch lesson libraries from anywhere, install the `nex` command globally (Volta shims it):

```sh
just install   # = pnpm build && npm install -g .
```

```sh
nex                # serve the cwd's lesson library (resolution below)
nex ~/teaching     # serve ~/teaching's lesson library
nex --port 4700    # starting port (default 6767, or $NEX_PORT); walks up if busy
nex --no-open      # don't open the browser
```

Library resolution, first match wins: `<dir>/.nex/lessons` (the convention for lessons that live inside the project they're about — keep `.nex/` in your global gitignore), `<dir>/lessons`, `<dir>` itself.

The server binds to localhost only. Re-run `just install` after pulling changes — the global command is a built artifact, not live source. Per-user state (history, exercise workspaces, config) is machine-global and shared across lesson libraries; **history is keyed by lesson slug alone**, so keep slugs unique across your libraries.

Open http://localhost:5173. By default the LLM backend is the **Claude Code CLI**, run headlessly with its own subscription login — if `claude` is installed and logged in (`/login`), no further setup is needed and usage is billed to the subscription rather than API token pricing. Each lesson gets a persistent CLI session, so repeated turns skip startup cost and keep conversational context server-side.

To call the Anthropic API directly instead, set `NEX_BACKEND=api` and provide `ANTHROPIC_API_KEY` (environment or `.env`; see `.env.example`).

### Configuration (environment or .env)

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEX_BACKEND` | `claude-code` | `claude-code` (headless CLI, subscription-billed) or `api` (direct Anthropic API) |
| `NEX_MODEL` | `claude-opus-4-8` | Model used for tutoring and grading |
| `NEX_EFFORT` | `low` | Reasoning effort (`low`–`max`); `low` roughly halves time-to-first-token |
| `NEX_LESSONS_DIR` | `./lessons` | Lesson library to serve (the `nex` CLI sets this from its argument) |
| `ANTHROPIC_API_KEY` | — | Only used with `NEX_BACKEND=api` (server-side only; never reaches the browser) |

### Coding exercises (`~/.config/nex/config.yaml`)

Lessons can ship exercise folders that open in *your* editor or multiplexer — nex deliberately does not embed an IDE. Configure how a folder gets opened once, at `~/.config/nex/config.yaml`:

```yaml
exercise:
  # {dir} and {name} are replaced with the (shell-quoted) workspace path and a
  # human-readable title. Runs via `sh -c` with the workspace as cwd.
  launch: zellij action new-tab --cwd {dir} --name {name}
```

Any command works — `code {dir}`, `alacritty --working-directory {dir} &`, `tmux new-window -c {dir}`, ... On first launch the exercise's template folder is copied to `~/.local/share/nex/workspaces/<lesson>/<exercise-id>`, so your progress survives relaunches and the template stays pristine.

### Terminal lesson steps (`~/.config/nex/config.yaml`)

Lessons can also offer a button that types a lesson-authored snippet into a named terminal target. The lesson selects a target by name; your local configuration owns the command and pane identifier, so lesson files never need to know about your multiplexer layout.

```yaml
terminal:
  targets:
    # `target: matlab` in a lesson resolves this live pane by its visible
    # Zellij tab and pane titles; numeric pane IDs can change between sessions.
    matlab:
      zellij:
        tab: matlab
        pane: matlab
```

Nex resolves a Zellij target by visible names once, then caches its live pane ID so later sends are immediate. A send failure clears that cache; the next attempt resolves the names again. It refuses to send if the named pane is absent or ambiguous. Set `enter: false` under `zellij` when the learner should edit the text before running it. A target can alternatively be any shell command, including `tmux send-keys` or a custom resolver; it must contain `{text}`, which Nex safely shell-quotes. Sending is deliberate: the learner presses the button for each step, can inspect the terminal result, and then continues the lesson.

## Writing lessons

Drop a `.md` file into `lessons/` — it appears on the picker immediately (lessons are re-read per request in dev). The format is Markdown with YAML frontmatter and ` ```question ` fenced YAML blocks; see **[LESSON_FORMAT.md](LESSON_FORMAT.md)** for the full spec, which is written to be handed directly to an LLM as authoring instructions.

A sample lesson lives at `lessons/big-o-notation.md`.

## Development

```sh
pnpm dev      # dev server
pnpm test         # parser unit tests (vitest)
pnpm check    # svelte-check / typescript
```

### Architecture

- `src/lib/lesson/` — lesson types and the Markdown+YAML parser (zod-validated, pure, unit-tested).
- `src/lib/server/` — lesson loading from disk, Anthropic client, prompt construction. The full lesson script sits in the system prompt with a prompt-cache breakpoint, so repeated turns in a session hit the cache.
- `src/routes/api/chat` — streaming endpoint (plain text chunks) for off-script questions and open-ended discussion.
- `src/routes/api/grade` — non-streaming endpoint for free-response grading, using structured outputs (JSON schema) so the verdict is machine-readable.
- `src/lib/chat/session.svelte.ts` — client-side session state machine (Svelte 5 runes): script cursor, pending question, transcript, persistence.
- `src/lib/markdown.ts` — marked + KaTeX + highlight.js rendering, shared by exposition and LLM output.
