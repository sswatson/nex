# Nex lesson format

A Nex lesson is a single Markdown file in the `lessons/` directory. The filename (minus `.md`) becomes the lesson's URL slug. This document is the authoring spec — it is written so that an LLM (or human) can produce a valid lesson from it directly.

## Overall structure

```markdown
---
title: Lesson Title            # required
description: One-line summary. # optional, shown on the lesson picker
---

Exposition in ordinary Markdown...

​```question
type: multiple-choice
prompt: ...
choices: [...]
​```

More exposition...
```

- **YAML frontmatter** (required): `title`, optional `description`.
- **Exposition**: plain Markdown between question blocks.
- **Questions**: fenced code blocks with the language tag `question`, containing YAML.

## How exposition is delivered

The lesson is presented as a chat: exposition appears verbatim, one message at a time, and the learner presses Continue (or Enter) to advance. Chunking rules:

- Each top-level Markdown block (paragraph, list, code fence, table, blockquote) becomes **one chat message**.
- A **heading attaches to the block that follows it** (so a heading plus its first paragraph are one message).
- A horizontal rule (`---`) forces a chunk boundary and is not displayed. (You rarely need this.)

**Authoring implication: write short, purposeful paragraphs.** Each paragraph should read well as a standalone chat message — roughly 1–4 sentences. Avoid page-length paragraphs.

Markdown support in exposition (and in question prompts/explanations):

- Standard Markdown: bold, italics, links, lists, tables, blockquotes, images.
- **Images**: put image files anywhere in the lessons directory (convention: the lesson's own folder, next to its exercises) and reference them by path relative to `lessons/`: `![growth curves](my-lesson/growth-curves.svg)`. Served formats: png, jpg, gif, webp, svg, avif. Absolute paths and full URLs pass through unchanged. Always write meaningful alt text. SVGs can adapt to the app's dark mode with a `prefers-color-scheme` media query in their own `<style>`.
- **Math**: `$...$` for inline LaTeX, `$$...$$` for display LaTeX (rendered with KaTeX). Dollar signs are reserved for math — write "USD 5" rather than "$5".
- **Code**: fenced code blocks with a language tag get syntax highlighting. Any language tag except `question` and `mermaid` is treated as ordinary code.
- **Diagrams**: fenced code blocks tagged `mermaid` render as [Mermaid](https://mermaid.js.org) diagrams (flowcharts, sequence/state diagrams, trees). Quote node labels containing parentheses or special characters: `A["O(n log n)"]`.

## Embedded interactive widgets

When a point is best made by something the learner can poke at — a slider, a simulation, a visualization — embed a small self-contained web app from the lesson's folder. An `embed` fence renders as a sandboxed iframe, delivered as its own chat message:

```embed
src: my-lesson/growth-race/index.html
height: 250
title: Operation counts by growth class
```

- `src` (required): path relative to `lessons/` — no absolute paths, URLs, or `..`.
- `height` (optional, default 400): iframe height in px — the sandbox prevents auto-sizing, so set it to fit the widget's content.
- `title` (optional): accessibility title for the iframe.

Widget authoring rules:

- **One self-contained HTML file** (inline CSS and JS) is the ideal form; multi-file widgets work too — relative `script`/`link` paths resolve within the lesson folder (served types: html, css, js, json, wasm).
- **No external dependencies** (CDN scripts, remote fonts) — lessons should work offline.
- **The sandbox gives widgets a null origin**: scripts run, but there's no access to the app's storage or API, no `localStorage` inside the widget, and no communication with the chat.
- Support dark mode with a `prefers-color-scheme` media query, and keep `background: transparent` so the chat bubble shows through.

## Question blocks

A question block is YAML inside a ` ```question ` fence. All types share:

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | `multiple-choice`, `free-response`, `open-ended`, `exercise`, or `terminal` |
| `prompt` | yes | The question text (Markdown + math) |
| `id` | no | Stable identifier; defaults to `q1`, `q2`, ... in document order. Must be unique. |

Use YAML block scalars (`|` or `>`) for multi-line prompts. **When a string value contains LaTeX, use single quotes or no quotes — never double quotes**: YAML treats backslashes in double-quoted strings as escape sequences, so `"$O(n \log n)$"` is a YAML error while `'$O(n \log n)$'` is fine.

### `multiple-choice`

Deterministically graded in the app — no LLM call.

```yaml
type: multiple-choice
prompt: What is the derivative of $x^3$?
choices:
  - text: "$3x^2$"
    correct: true
    explanation: Bring down the exponent and reduce it by one.
  - text: "$x^2$"
    explanation: Don't forget the coefficient from the power rule.
  - text: "$3x^3$"
```

- `choices`: at least 2; each has `text` (required), `correct` (default false), `explanation` (optional, shown after the learner answers).
- At least one choice must be `correct: true`.
- If the learner picks a wrong choice, the app shows that choice's explanation plus the correct answer.
- Write explanations for wrong choices whenever the mistake is instructive.

### `free-response`

The learner types an answer; an LLM grades it (correct / partial / incorrect) and writes feedback. If the learner asks a clarifying question instead of answering, the LLM answers it and the question stays open.

```yaml
type: free-response
prompt: Explain why the sky is blue.
criteria: >
  Mentions that shorter (blue) wavelengths scatter more strongly off air
  molecules (Rayleigh scattering). Bonus if they note why the sky isn't violet.
sample_answer: >
  Air molecules scatter short wavelengths much more than long ones, so blue
  light reaches our eyes from all directions.
```

- At least one of `criteria` / `sample_answer` is required; providing both gives the best grading.
- `criteria` is instructions to the grader: what a correct answer must include, and what to accept or reject. Be explicit about acceptable variation.

### `open-ended`

No right answer. The learner's response gets a thoughtful LLM reply, then the lesson continues.

```yaml
type: open-ended
prompt: What did you find most surprising in this section?
context: >
  Optional guidance for the tutor's reply — what to highlight, connect,
  or gently probe.
```

### `exercise`

A hands-on exercise backed by a folder that ships alongside the lesson. The prompt appears in the chat with an **Open exercise** button: clicking it copies the folder to a per-learner workspace (`~/.local/share/nex/workspaces/<lesson>/<id>` — first launch only, so progress survives relaunches) and opens it with the user's configured launch command (editor, multiplexer tab; see the README for `~/.config/nex/config.yaml`). The learner works in their own tools and presses Continue when done — no answer is collected in the chat.

```yaml
type: exercise
id: faster-duplicates
prompt: |
  Rewrite `has_duplicate` in `duplicates.py` to run in $O(n)$, then check your
  work with `python3 test_duplicates.py`.
folder: big-o-notation/faster-duplicates
context: >
  Optional guidance for the tutor: the intended solution, hints to give before
  revealing it, and what the test script checks.
```

- `folder` (required): path relative to the `lessons/` directory — no absolute paths or `..`. Convention: a directory named after the lesson, one subfolder per exercise.
- Give exercises an explicit, stable `id` — it names the learner's workspace directory.
- Make the folder self-sufficient: a short `README.md` with the task, starter files, and a self-checking test script the learner can run (`python3 test_x.py`, `cargo test`, ...). The app does not validate completion.
- The tutor cannot see the learner's files — write `context` so it can help from the description alone.

### `terminal`

A terminal step offers a **Send to _target_** button that injects lesson text through a command configured by the learner. It is useful for a tutorial that should run a small MATLAB, Python, or shell command while leaving the learner free to inspect the live REPL. The learner explicitly presses the button; Nex never sends the text merely because they advance through the lesson.

```yaml
type: terminal
id: plot-sine
prompt: Send this to MATLAB, then inspect the plot before continuing.
target: matlab
text: |
  x = linspace(0, 2*pi, 200);
  plot(x, sin(x)); grid on
context: >
  Help the learner read the axes and relate the sample count to the curve's
  smoothness.
```

- `target` (required): a simple name (`letters`, `numbers`, `_`, and `-`) matching an entry in `terminal.targets` in `~/.config/nex/config.yaml`. This lets each learner map `matlab` to their own Zellij, tmux, or other terminal command.
- `text` (required): the exact non-empty text to inject. Use a YAML block scalar for multi-line code.
- `show_text` (optional, default `true`): show the exact snippet in the chat above the Send button. Set this to `false` only when a large or sensitive payload would make the lesson harder to read.
- A Zellij target should identify its visible `tab` and `pane` names, which Nex resolves immediately before sending; it refuses to guess if there is no unique live match. A custom command receives the safely shell-quoted text in its `{text}` placeholder. Set `zellij.enter: false` if the learner should edit the text before running it.
- `context` (optional): guidance for the tutor when the learner asks about this step.

## Off-script behavior (for context)

At any point the learner can type a question instead of advancing; the LLM tutor answers using the full lesson script as context and steers them back. The tutor can see the whole script (including answers), so grading criteria and explanations you write also improve off-script help. The tutor is instructed not to reveal answers to unanswered questions.

## Authoring checklist

1. Frontmatter has `title`.
2. Paragraphs are chat-message sized (1–4 sentences).
3. Every question fence is tagged `question` and contains valid YAML.
4. Multiple-choice: ≥2 choices, ≥1 `correct: true`, explanations on instructive wrong answers.
5. Free-response: `criteria` (and ideally `sample_answer`) present.
6. Math in `$...$` / `$$...$$`; no bare `$` for currency.
7. A question every 3–6 exposition messages keeps the lesson interactive.
8. End with a short wrap-up message.
