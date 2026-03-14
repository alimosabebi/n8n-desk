# MANIFEST — n8n-desk

> A self-harnessed agent for n8n — powerful enough to automate your desktop, constrained enough to stay safe.

---

## The Idea

n8n-desk is an **agent-first desktop companion** for n8n. It brings your n8n automation workflows out of the browser and onto your desktop as a conversational interface — and extends them into your local filesystem.

The core insight: **the best agent is one that doesn't need to write code.** Traditional coding agents (Claude Code, Cursor, Copilot) are general-purpose — they can do anything, which means they can break anything. n8n-desk takes a fundamentally different approach: the agent operates within the **closed system of n8n's existing capabilities**. It plans, reasons, and executes — but its hands are n8n workflows, not arbitrary code.

This is a **self-harnessing architecture.** n8n provides the guardrails. Every action the agent takes is either:

1. **Calling an existing n8n workflow** — pre-built, pre-tested, scoped to what you've already approved.
2. **Managing workflows through n8n's own API** — creating, editing, and validating workflows via the structured MCP interface, not by generating raw code.
3. **Reading and writing local files** — scoped to a working directory, no shell access, no code execution.

The agent never escapes the boundaries of what n8n already allows. It's powerful because n8n is powerful. It's safe because n8n is the perimeter.

---

## Why This Exists

n8n is extraordinarily capable — hundreds of integrations, complex workflow logic, error handling, scheduling, webhooks. But interacting with it still means navigating a visual editor, manually triggering workflows, and switching between browser tabs to check results.

n8n-desk closes this gap:

- **Talk instead of click.** Describe what you want in natural language. The agent figures out which workflows to run, chains them together, and delivers results.
- **Desktop-native automation.** Process files on your machine using n8n workflows — invoices, reports, images, data exports — without uploading anything to a web UI.
- **Workflow management without the canvas.** Create and modify n8n workflows through conversation. The agent uses the n8n MCP server to build valid workflows programmatically, with inline visual previews.

---

## The Constraint Model

What makes n8n-desk different from general-purpose coding agents:

| | Coding Agents (Claude Code, etc.) | n8n-desk |
|---|---|---|
| **Execution** | Runs arbitrary code | Calls n8n workflows — no code execution |
| **Scope** | Entire filesystem, shell, network | Working directory (files) + n8n instance (workflows) |
| **Actions** | Unbounded | 13 defined MCP tools + file read/write |
| **Guardrails** | LLM self-regulation + user approval | n8n's permission system + structured API + user approval |
| **Destructive potential** | High (rm -rf, git push --force) | Low (worst case: creates a bad workflow you can undo) |
| **Auditability** | Git diffs after the fact | Every action is an n8n API call with full execution logs |

The agent is deliberately **not** a general-purpose assistant. It cannot install packages, run shell commands, make arbitrary HTTP requests, or modify system configuration. It operates through n8n, and n8n's own access controls, execution logs, and workflow versioning provide a natural safety net.

---

## Three Modes of Interaction

n8n-desk organizes around three modes, each with a different level of agency:

### Chat — Zero agency, full convenience
A thin client to n8n's Chat-Hub. Talk to your workflow agents and assistants. The app just routes messages — no local agent, no file access, no workflow editing. Works on desktop and mobile.

### Cowork — Controlled agency, local reach
A local planning agent that **uses your existing workflows as tools**. It can read and write files in your working directory and call n8n workflows to process them. It cannot create or modify workflows — only use what already exists. Think of it as a power user who knows your automation library and applies it to local tasks.

### Workflow — Structured agency, workflow scope
A local agent with full workflow management capabilities through n8n's MCP server. It can create, edit, validate, publish, and archive workflows — but only through the 13 defined MCP tools, never by injecting raw code. Visual previews render inline so you see what the agent built before it goes live.

---

## What Makes It Safe

1. **No code execution.** The agent cannot run scripts, spawn processes, or execute arbitrary commands. Period.
2. **n8n is the perimeter.** Every integration, every API call, every data transformation happens inside n8n workflows — subject to n8n's own permissions, credentials, and execution logging.
3. **Structured API surface.** The 13 MCP tools are the complete vocabulary of what the agent can do with n8n. No escape hatches.
4. **File access is scoped.** Local file operations are sandboxed to the working directory. No traversal, no system files, no shell.
5. **Human-in-the-loop by default.** Destructive operations (execute, create, update, publish, archive workflows) require explicit user approval before proceeding.
6. **Full auditability.** Every workflow execution is logged in n8n. Every agent action is recorded in the local session history. Nothing happens silently.

---

## Who It's For

- **n8n users** who want to interact with their automations conversationally instead of through a browser UI.
- **Teams** where non-technical members need to trigger and monitor workflows without learning the visual editor.
- **Power users** who want their n8n workflows to reach into their local filesystem — processing documents, generating reports, organizing files — without manual upload/download cycles.
- **Anyone** who wants an agent that's useful enough to automate real work but constrained enough that you don't worry about what it might do unsupervised.

---

## The Name

**n8n-desk** — your n8n automations, at your desk. A desktop-native, agent-first interface where workflows come to you instead of you going to them.

---

*For the full technical spec, see [PROJECT.md](PROJECT.md). For build instructions, see [CLAUDE.md](CLAUDE.md).*
