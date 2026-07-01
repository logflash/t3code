# T3 Code (Ian Henriques' fork)

T3 Code is a minimal web/desktop GUI for coding agents — it gives you a single
interface in front of CLI agents like Codex, Claude, Cursor, and OpenCode, with
threaded conversations, a sidebar of projects, and git/worktree integration.

This is my fork. It tracks upstream but adds the features below.

## What's different in this fork

I've been working on my own fork with many new features. The main additions:

- **Per-conversation cost tracking.** Each thread shows its running cost next to
  the title — real figures from Claude, token×price estimates (prefixed `est.`)
  for the rest.

- **Conversation forking.** Branch any chat into a fresh draft that inherits its
  model, modes, and worktree. Nothing's saved until you send.

- **Message queue.** Line up follow-up prompts in a git-style Queue panel: park
  ideas as *Unstaged*, stage the ones you want to send, and staged messages fire
  top-to-bottom as soon as the agent goes idle (with a pause toggle to hold them).
  Drag to reorder, double-click to edit, and once anything's staged your normal
  sends fall in line behind it instead of jumping ahead.

- **Sync with remote, with LLM conflict resolution (experimental).** Pull a remote
  branch into your thread's branch from a dialog; conflicts are resolved and
  verified by an LLM, and the whole merge rolls back if anything can't be resolved
  safely.

- **Full-text message search.** The command palette searches message content, not
  just titles, and clicking a hit jumps to that message and highlights it.

- **VS Code theme import.** Use your installed VS Code themes for code blocks and
  diffs; new ones show up without a restart.

- **A real PR workflow.** Separate Development and Pull Requests tabs, a PR picker,
  live PR status badges, and auto-archive once a PR is merged or closed.

- **Bookmarking.** Option/Alt+click a thread in the sidebar to bookmark it.

- **Page zoom that behaves.** Cmd +/− zooms the whole UI with the chrome (context
  menus, macOS traffic-light spacing) staying aligned.

- **One-command setup.** `./setup.sh` gets you running on macOS in one step, with a
  flag to skip Homebrew if you manage your own deps.

Everything's covered by tests. Cost figures are estimates, not billing.

## Getting started with my fork

Install and authenticate at least one provider before use:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `cursor-agent login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

Then, from a clone of this fork on macOS, use my custom install script:

```bash
./setup.sh
```

This installs the toolchain (including the `vp` / Vite+ CLI the dev runner needs)
and workspace dependencies. It's idempotent, and if you manage system deps
yourself (Nix, etc.) run `T3_SETUP_NO_BREW=1 ./setup.sh` to verify rather than
install them.

Then start the desktop dev server with:

```bash
vp run dev:desktop
```
