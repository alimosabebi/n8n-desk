# PRD: Local File Tools & JavaScript Compute Sandbox

## Overview

Two categories of local agent tools that run in Electron's main process — fast, offline-capable, no network needed:

1. **File operation tools** — Pre-built, deterministic functions for reading/writing common business file formats (Excel, CSV, PDF, docx, JSON, YAML). The agent calls `read_excel(path)` — it does not write or control the parsing code.

2. **Local JS compute sandbox** — A lightweight Node.js `vm` context with zero injected APIs (no `fs`, `require`, `child_process`). The agent can generate JavaScript for data transformation and computation that runs locally and instantly. This is safe because the sandbox has no I/O capabilities — it's essentially a programmable calculator.

Together, these cover ~95% of agent file/data work. Only Python execution and JS requiring npm modules needs the remote sandbox.

## Problem Statement

n8n-desk agents currently cannot interact with files on disk. The remote code sandbox PRD addresses arbitrary code execution, but most agent file work doesn't need code at all — it's just "read this spreadsheet" or "write these results to a docx." Routing every file operation through a remote sandbox adds latency, requires network connectivity, and is overkill for deterministic parsing.

Meanwhile, n8n itself has a known weakness with file operations — workflows often struggle with Excel, PDF, and docx handling. Local file tools in n8n-desk fill this gap directly.

## Goals

- Agents can read structured data from Excel (.xlsx/.xls), CSV, PDF, docx, JSON, YAML files
- Agents can write structured data to Excel, CSV, docx, JSON, YAML files
- File tools are pre-built functions — no user-supplied code, deterministic
- Local JS sandbox executes agent-generated JavaScript in a zero-API `vm` context (no `fs`, `require`, `process`, `child_process`)
- All tools respect the filesystem sandbox policy (only allowed folders, deny-listed files)
- Everything runs in Electron's main process (fast, offline-capable, no network needed)
- Tools are available in both Cowork and Workflow agent modes
- Both Deep Agents and Claude SDK backends can use these tools
- Local JS sandbox has timeout and memory enforcement

## Non-Goals

- No arbitrary code execution (that's the remote sandbox's job)
- No file format conversion (e.g., PDF → docx) in MVP — just read/write
- No image content extraction (OCR) — just metadata
- No video/audio file handling
- No database file handling (SQLite, etc.)
- No file watching or auto-sync
- No streaming for very large files (>100MB) in MVP
- Local JS sandbox does NOT get Node.js APIs — no `fs`, `require`, `child_process`, `process`, `Buffer`, `setTimeout`. Only data processing.
- Python execution stays remote-only — Python's import system is too hard to sandbox safely locally
- Bash/shell execution is never available locally

## Technical Design

### Tool Inventory

| Tool | Input | Output | npm Package |
|---|---|---|---|
| `read_excel` | file path, sheet name (optional) | `{ sheets: [{ name, rows: [{...}] }] }` | `xlsx` (SheetJS) |
| `write_excel` | file path, sheets data | file written, returns path | `xlsx` |
| `read_csv` | file path, delimiter (optional) | `{ rows: [{...}], columns: [...] }` | `papaparse` |
| `write_csv` | file path, rows, columns | file written, returns path | `papaparse` |
| `read_pdf` | file path, pages (optional) | `{ text, pages: [{text, pageNum}], metadata }` | `pdf-parse` |
| `read_docx` | file path | `{ text, paragraphs: [...], metadata }` | `mammoth` |
| `write_docx` | file path, content (markdown or structured) | file written, returns path | `docx` |
| `read_json` | file path | parsed object | built-in `JSON.parse` |
| `write_json` | file path, data, pretty (optional) | file written, returns path | built-in `JSON.stringify` |
| `read_yaml` | file path | parsed object | `js-yaml` |
| `write_yaml` | file path, data | file written, returns path | `js-yaml` |
| `read_text` | file path, encoding (optional) | `{ content, lines, sizeBytes }` | built-in `fs.readFile` |
| `write_text` | file path, content | file written, returns path | built-in `fs.writeFile` |

### Local JavaScript Compute Sandbox

A lightweight, zero-API `vm` context for agent-generated JavaScript. The agent can generate code for data transformation, filtering, aggregation, and computation that runs locally and instantly.

**Why this is safe:**

The Node.js `vm` module creates an isolated V8 context. What you inject into it is what it has access to. By injecting **only data and safe builtins**, the sandbox becomes a pure computation engine — it literally cannot touch the filesystem, network, or OS.

**What's injected into the VM context:**

| Global | Why | Safe? |
|---|---|---|
| `JSON` | Parse/stringify data | Yes — pure functions |
| `Math` | Computation | Yes — pure functions |
| `Date` | Date manipulation | Yes — read-only clock |
| `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set` | Data structures | Yes — standard JS |
| `console.log` / `console.error` | Output capture | Yes — captured to string buffer |
| `structuredClone` | Deep copy | Yes — pure function |
| `inputData` | Data from the agent | Yes — read-only input |

**What's NOT injected (and therefore inaccessible):**

| Blocked | Why it's dangerous |
|---|---|
| `require` / `import` | Could load any Node module |
| `process` | OS access, env vars, exit |
| `fs` / any Node API | Filesystem access |
| `child_process` | Shell execution |
| `Buffer` | Binary data + potential exploits |
| `setTimeout` / `setInterval` | Event loop manipulation |
| `fetch` / `http` | Network access |
| `eval` / `Function` | Blocked by `--disallow-code-generation-from-strings` |
| `globalThis` / `global` | Escape to Node.js global scope |
| `Proxy` / `Reflect` | Can be used to probe the sandbox boundary |

**Implementation:**

```ts
import { createContext, runInContext, Script } from 'vm'

interface JsSandboxResult {
  result: unknown
  stdout: string
  stderr: string
  executionTimeMs: number
}

function executeInSandbox(code: string, inputData: unknown, timeoutMs = 10000): JsSandboxResult {
  const stdout: string[] = []
  const stderr: string[] = []

  // Create isolated context with ONLY safe globals
  const context = createContext({
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    structuredClone,
    console: {
      log: (...args: unknown[]) => stdout.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
    },
    inputData: structuredClone(inputData), // deep copy, not a reference
  })

  // Freeze all prototypes to prevent pollution
  const script = new Script(`
    Object.freeze(Object.prototype);
    Object.freeze(Array.prototype);
    Object.freeze(String.prototype);
    Object.freeze(Function.prototype);
    ${code}
  `)

  const start = performance.now()
  const result = script.runInContext(context, { timeout: timeoutMs })
  const executionTimeMs = Math.round(performance.now() - start)

  return {
    result,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
    executionTimeMs,
  }
}
```

**Node.js process flags** (set when spawning the agent worker or in Electron main):
```
--disallow-code-generation-from-strings  // blocks eval() and new Function()
--disable-proto=delete                   // blocks __proto__ manipulation
```

**LangChain tool:**

```ts
const jsComputeTool = tool(
  async ({ code, inputData }) => {
    try {
      const result = executeInSandbox(code, inputData ?? {}, 10000)
      return JSON.stringify({
        result: result.result,
        stdout: result.stdout,
        stderr: result.stderr,
        executionTimeMs: result.executionTimeMs,
      })
    } catch (err) {
      if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        return JSON.stringify({ error: 'Execution timed out (10s limit)', type: 'timeout' })
      }
      return JSON.stringify({ error: err.message, type: 'runtime' })
    }
  },
  {
    name: 'js_compute',
    description: 'Execute JavaScript code locally for data transformation and computation. The code runs in a sandboxed environment with NO access to filesystem, network, or Node.js APIs. Only has access to: JSON, Math, Date, standard JS builtins, console.log, and inputData. Use for: filtering, mapping, aggregation, sorting, math, string manipulation, date calculations. Returns the last expression value.',
    schema: z.object({
      code: z.string().describe('JavaScript code to execute. The last expression is returned as the result. Access input via the `inputData` global variable.'),
      inputData: z.record(z.unknown()).optional().describe('Data to make available as the `inputData` global variable.'),
    }),
  }
)
```

**Approval:** `js_compute` does NOT require human-in-the-loop approval. The sandbox has zero I/O — it can only compute and return data. The worst case is a timeout or memory error, both of which are handled. This makes it as frictionless as the file tools.

**Memory limit:** Run in a Node.js worker thread with `--max-old-space-size=128` to cap memory. If the computation exceeds 128MB, the worker crashes cleanly and the tool returns an error.

**When to use `js_compute` vs `run_code` (remote):**

| Use `js_compute` (local) | Use `run_code` (remote) |
|---|---|
| Filter/map/reduce arrays | Need `lodash`, `moment`, or other npm packages |
| Math, statistics, percentiles | Need Python |
| String manipulation, regex | Need filesystem access from code |
| Date calculations | Need network from code |
| JSON transformation | Generate files (charts, images) |
| Sorting, grouping, dedup | Very heavy computation (>128MB data) |

### Security Model

**File tools execute NO user code.** The agent provides a file path and optional parameters (sheet name, delimiter). The tool does a deterministic library call and returns structured data. There is no `eval()`, no `Function()`, no template rendering, no expression evaluation.

**Filesystem sandbox integration:** Every tool call goes through the sandbox filter from the `agent-filesystem-sandbox.md` PRD:

```ts
async function readExcel(filePath: string, options?: { sheet?: string }) {
  // 1. Validate path against sandbox policy
  const resolvedPath = await resolveAndValidatePath(filePath, currentPolicy)
  if (!resolvedPath) throw new Error('Access denied: path outside allowed folders')

  // 2. Check read deny-list
  if (isReadDenied(resolvedPath, currentPolicy.readDenyList)) {
    throw new Error('Access denied: file type blocked')
  }

  // 3. Deterministic library call — no user code
  const workbook = XLSX.readFile(resolvedPath)
  // ... parse and return structured data
}
```

**Write tools also check:**
- Path is in an allowed folder with `rw` mode
- File extension is in the writable extensions list
- File doesn't match the write deny-list

**Library safety:** The npm packages used (`xlsx`, `papaparse`, `pdf-parse`, `mammoth`, `docx`, `js-yaml`) are well-known, widely audited libraries. They parse file formats — they don't execute code. The main risk is malformed files causing crashes, mitigated by:
- Try/catch around all parse operations
- File size limits (configurable, default 100MB)
- Timeout per operation (configurable, default 30s)

### Implementation Architecture

```
Agent (LangChain tool call)
  ↓
electron/agent/file-tools.ts (LangChain tool wrappers)
  ↓
electron/agent/sandbox-filter.ts (path validation + deny-list)
  ↓
electron/agent/file-parsers/ (one module per format)
  ├── excel.ts      → xlsx
  ├── csv.ts        → papaparse
  ├── pdf.ts        → pdf-parse
  ├── docx-read.ts  → mammoth
  ├── docx-write.ts → docx
  ├── json.ts       → built-in
  ├── yaml.ts       → js-yaml
  └── text.ts       → built-in fs
```

Tools run in Electron's **main process** (same as the agent runner). They have access to the filesystem via Node.js `fs` but are gated by the sandbox policy.

### Data Size Handling

File operations can return large data. Strategy:

- **Small files (<1MB parsed):** Return full structured data to the agent
- **Large files (1-10MB parsed):** Return a summary + first N rows, with a note: "File has 50,000 rows. Showing first 100. Use `read_excel` with `offset` and `limit` for pagination."
- **Very large files (>10MB parsed):** Return metadata only (row count, column names, file size). Agent must use pagination or push to remote sandbox for processing.

```ts
read_excel(path, { sheet?: string, offset?: number, limit?: number })
read_csv(path, { delimiter?: string, offset?: number, limit?: number })
```

### Tool Schemas (LangChain/Zod)

```ts
const readExcelTool = tool(
  async ({ filePath, sheet, offset, limit }) => { ... },
  {
    name: 'read_excel',
    description: 'Read an Excel file (.xlsx/.xls). Returns sheet names, column headers, and row data as structured JSON. For large files, use offset/limit for pagination.',
    schema: z.object({
      filePath: z.string().describe('Path to the Excel file'),
      sheet: z.string().optional().describe('Sheet name to read. If omitted, reads all sheets.'),
      offset: z.number().optional().describe('Start row (0-indexed). For paginating large files.'),
      limit: z.number().optional().describe('Max rows to return. Default 100 for large files.'),
    }),
  }
)

const writeExcelTool = tool(
  async ({ filePath, sheets }) => { ... },
  {
    name: 'write_excel',
    description: 'Write data to an Excel file (.xlsx). Creates or overwrites the file.',
    schema: z.object({
      filePath: z.string().describe('Path for the output Excel file'),
      sheets: z.array(z.object({
        name: z.string().describe('Sheet name'),
        rows: z.array(z.record(z.unknown())).describe('Array of row objects (column name → value)'),
      })).describe('Sheets to write'),
    }),
  }
)

const readPdfTool = tool(
  async ({ filePath, pages }) => { ... },
  {
    name: 'read_pdf',
    description: 'Extract text content from a PDF file. Returns text per page and document metadata.',
    schema: z.object({
      filePath: z.string().describe('Path to the PDF file'),
      pages: z.string().optional().describe('Page range to read (e.g., "1-5", "3", "10-20"). If omitted, reads all pages.'),
    }),
  }
)

const readCsvTool = tool(
  async ({ filePath, delimiter, offset, limit }) => { ... },
  {
    name: 'read_csv',
    description: 'Read a CSV file. Auto-detects delimiter. Returns column headers and row data as structured JSON.',
    schema: z.object({
      filePath: z.string().describe('Path to the CSV file'),
      delimiter: z.string().optional().describe('Column delimiter. Auto-detected if omitted.'),
      offset: z.number().optional().describe('Start row (0-indexed).'),
      limit: z.number().optional().describe('Max rows to return.'),
    }),
  }
)

const readDocxTool = tool(
  async ({ filePath }) => { ... },
  {
    name: 'read_docx',
    description: 'Read a Word document (.docx). Returns text content, paragraphs, and document metadata.',
    schema: z.object({
      filePath: z.string().describe('Path to the .docx file'),
    }),
  }
)

const writeDocxTool = tool(
  async ({ filePath, content, format }) => { ... },
  {
    name: 'write_docx',
    description: 'Write content to a Word document (.docx). Accepts plain text or markdown-formatted content.',
    schema: z.object({
      filePath: z.string().describe('Path for the output .docx file'),
      content: z.string().describe('Content to write. Supports markdown formatting (headings, bold, lists, tables).'),
      format: z.enum(['markdown', 'plain']).optional().describe('Content format. Default: markdown.'),
    }),
  }
)
```

### When the Agent Should Use Remote Sandbox Instead

The system prompt should guide the agent:

```
## Tool Selection Guide

You have THREE tiers of tools. Always prefer the fastest/simplest tier that works.

### Tier 1: Local File Tools (instant, no code, no approval)
  read_excel, read_csv, read_pdf, read_docx, write_excel, write_csv, write_docx,
  read_json, write_json, read_yaml, write_yaml, read_text, write_text

  Use for: Reading file contents, writing structured data, simple lookups.

### Tier 2: Local JS Compute (instant, sandboxed, no approval)
  js_compute — runs JavaScript in a sandboxed VM with zero I/O.

  Available: JSON, Math, Date, Array/Object/String methods, RegExp, Map, Set.
  NOT available: require, fs, fetch, setTimeout, Buffer, process, child_process.

  Use for: Filtering, mapping, aggregation, sorting, math, statistics, percentiles,
  string manipulation, regex, date calculations, JSON transformation.

  Input data via `inputData` global. Last expression is the return value.

### Tier 3: n8n Workflows (remote, powerful, approval required)
  execute_workflow — runs an existing n8n workflow on the connected instance.

  Use for: Anything requiring third-party integrations, npm packages (lodash, moment,
  pandas), Python, API calls, email, Slack, databases, or any n8n node capability.

  When you need a library or service that isn't available locally, check if there's
  an n8n workflow that does it. n8n has 400+ integrations — use them.

### Tier 4: Remote Code Sandbox (remote, arbitrary code, approval required)
  run_code — executes JS or Python on the remote sandbox.

  Use ONLY when: You need to write custom code that requires npm/pip packages,
  Python specifically, or heavy computation (>128MB data).
  This is the last resort — prefer n8n workflows for third-party operations.

### Decision flow:
  Can I read/write a file? → Tier 1
  Can I compute with basic JS? → Tier 2
  Is there an n8n workflow for this? → Tier 3
  Do I need custom code with libraries? → Tier 4
```

### Integration with Filesystem Sandbox

The file tools are tightly integrated with `agent-filesystem-sandbox.md`:

- **Attached folders**: File tools can only access folders the user has attached to the session
- **`~/.n8n-desk/` access**: Read-only (minus deny-listed files), skills dir writable
- **Extension checks**: Write tools validate the output file extension is in the allowed list
- **Path validation**: Every tool call resolves the path, checks `realpath` for symlink escapes
- **No approval needed**: Unlike `run_code`, file read/write operations don't require human-in-the-loop approval. The folder attachment IS the trust grant.

### Interface Changes

**New IPC channels** (for Claude SDK backend, which can't call LangChain tools directly):

| Channel | Direction | Purpose |
|---|---|---|
| `file:read-excel` | renderer → main | Read Excel file |
| `file:write-excel` | renderer → main | Write Excel file |
| `file:read-csv` | renderer → main | Read CSV file |
| `file:write-csv` | renderer → main | Write CSV file |
| `file:read-pdf` | renderer → main | Read PDF file |
| `file:read-docx` | renderer → main | Read docx file |
| `file:write-docx` | renderer → main | Write docx file |

For the Deep Agents backend, the tools are registered as LangChain tools directly — no IPC needed.

### Dependencies

```json
{
  "xlsx": "^0.18.5",
  "papaparse": "^5.4.1",
  "pdf-parse": "^1.1.1",
  "mammoth": "^1.6.0",
  "docx": "^8.5.0",
  "js-yaml": "^4.1.0"
}
```

Total bundle size impact: ~5MB (xlsx is the largest at ~3MB).

### Migration Strategy

None. New tools, additive feature. Agents without file tools attached to their session simply don't have these tools available.

## Implementation Steps

1. **Create file parser modules** — New directory `electron/agent/file-parsers/`:
   - `excel.ts` — `readExcel(path, options?)` and `writeExcel(path, sheets)` using `xlsx`
   - `csv.ts` — `readCsv(path, options?)` and `writeCsv(path, rows, columns)` using `papaparse`
   - `pdf.ts` — `readPdf(path, options?)` using `pdf-parse`
   - `docx-read.ts` — `readDocx(path)` using `mammoth`
   - `docx-write.ts` — `writeDocx(path, content, format)` using `docx`
   - `json.ts` — `readJson(path)` and `writeJson(path, data, pretty?)` using built-in JSON
   - `yaml.ts` — `readYaml(path)` and `writeYaml(path, data)` using `js-yaml`
   - `text.ts` — `readText(path, encoding?)` and `writeText(path, content)` using `fs`
   - Each module: validate path via sandbox filter, parse/write, return structured result
   - Each module: try/catch with clear error messages, file size check, timeout

2. **Create LangChain tool wrappers** — New file `electron/agent/file-tools.ts`:
   - One `tool()` per file operation with Zod schema (as defined above)
   - Export `createFileTools(sandboxPolicy)` that returns the full array of file tools
   - Large file handling: auto-paginate when row count exceeds threshold

3. **Install npm dependencies** — Modify `package.json`:
   - Add `xlsx`, `papaparse`, `pdf-parse`, `mammoth`, `docx`, `js-yaml`
   - Add `@types/` packages for those that have them

4. **Register file tools with agent runners** — Modify `electron/agent/deep-agents-runner.ts`:
   - Import `createFileTools()` from `file-tools.ts`
   - When `config.sandboxPolicy` has mounts, create file tools and add to the tools array
   - File tools are NOT in `DESTRUCTIVE_TOOLS` — no approval needed

5. **Register file tools with Claude SDK runner** — Modify `electron/agent/claude-sdk-runner.ts`:
   - Add file tool IPC channels in `electron/ipc/file-tools.ts`
   - Register handlers that call the same parser modules
   - Expose via preload for the Claude SDK's tool system

6. **Update system prompts** — Modify `electron/agent/system-prompts.ts`:
   - Add "File Tools vs Code Execution" guidance (as specified above)
   - List available file tools with usage examples
   - Emphasize: use local tools first, remote sandbox only for computation

7. **Add file size and timeout safeguards** — In each parser module:
   - Check file size before parsing (configurable limit, default 100MB)
   - Wrap parse in a timeout (default 30s)
   - For large files: return metadata + pagination hint instead of full data

8. **Create local JS compute sandbox** — New file `electron/agent/js-sandbox.ts`:
   - `executeInSandbox(code, inputData, timeoutMs)` function using Node.js `vm.createContext()` + `Script.runInContext()`
   - Inject ONLY safe globals: `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set`, `structuredClone`, captured `console`
   - Freeze all prototypes before user code runs
   - `inputData` passed as deep clone (not reference)
   - Timeout enforcement via `vm` timeout option
   - Memory enforcement: run in worker thread with `--max-old-space-size=128`
   - Return `{ result, stdout, stderr, executionTimeMs }`

9. **Create `js_compute` LangChain tool** — In `electron/agent/file-tools.ts`:
   - Wraps `executeInSandbox()` as a LangChain `tool()` with Zod schema
   - NOT in `DESTRUCTIVE_TOOLS` — no approval needed
   - Returns structured JSON result or error

10. **Ensure Node.js security flags** — In `electron/main.ts` or agent worker spawn:
    - Pass `--disallow-code-generation-from-strings` and `--disable-proto=delete` to the process/worker running the sandbox
    - Verify these flags are active at startup

11. **Tests** — New files:
   - `electron/agent/file-parsers/__tests__/excel.test.ts` — Test read/write with sample files
   - `electron/agent/file-parsers/__tests__/csv.test.ts` — Test delimiters, encoding, large files
   - `electron/agent/file-parsers/__tests__/pdf.test.ts` — Test text extraction, page ranges
   - `electron/agent/file-parsers/__tests__/docx.test.ts` — Test read and write
   - `electron/agent/__tests__/file-tools.test.ts` — Test sandbox validation, deny-list, tool integration
   - `electron/agent/__tests__/js-sandbox.test.ts` — Test: basic computation works, `require` blocked, `process` blocked, `fs` blocked, `eval` blocked, timeout kills infinite loop, prototype pollution blocked, inputData accessible, stdout captured, memory limit works
   - Add sample test files in `electron/agent/file-parsers/__tests__/fixtures/`

## Validation Criteria

- [ ] `read_excel` returns structured rows from an .xlsx file
- [ ] `write_excel` creates a valid .xlsx file that opens in Excel
- [ ] `read_csv` auto-detects delimiter and returns structured rows
- [ ] `write_csv` creates a valid CSV file
- [ ] `read_pdf` extracts text from a multi-page PDF
- [ ] `read_pdf` with page range returns only specified pages
- [ ] `read_docx` extracts text and paragraph structure
- [ ] `write_docx` creates a valid .docx from markdown content
- [ ] `read_json` / `write_json` round-trips correctly
- [ ] `read_yaml` / `write_yaml` round-trips correctly
- [ ] File tools respect filesystem sandbox (blocked outside allowed folders)
- [ ] Read deny-list blocks `.env`, `.pem`, etc. even with file tools
- [ ] Write tools check extension allowlist
- [ ] Symlink escape is blocked
- [ ] Large Excel file (50k rows) returns paginated result with metadata
- [ ] File exceeding size limit returns clear error
- [ ] Malformed file returns parse error (not crash)
- [ ] File tools do NOT require human-in-the-loop approval
- [ ] File tools work offline (no network needed)
- [ ] Both Deep Agents and Claude SDK backends have access to file tools
- [ ] **JS sandbox**: `js_compute` executes basic JS and returns result
- [ ] **JS sandbox**: `inputData` is accessible from code
- [ ] **JS sandbox**: `console.log` output captured in stdout
- [ ] **JS sandbox**: `require()` is not available (throws ReferenceError)
- [ ] **JS sandbox**: `process` is not available
- [ ] **JS sandbox**: `fs` / filesystem access is not available
- [ ] **JS sandbox**: `eval()` is blocked (`--disallow-code-generation-from-strings`)
- [ ] **JS sandbox**: Infinite loop is killed after timeout (10s default)
- [ ] **JS sandbox**: Memory overflow is caught cleanly (128MB limit)
- [ ] **JS sandbox**: Prototype pollution is blocked (frozen prototypes)
- [ ] **JS sandbox**: Does NOT require human-in-the-loop approval
- [ ] System prompt guides agent through 4-tier tool selection (file → js_compute → n8n workflows → remote sandbox)

## Anti-Patterns to Avoid

- **Don't allow arbitrary code in file tools.** These tools take a path and optional parameters — never a code string, template, expression, or callback. If you find yourself adding an `eval()` or `Function()`, you're building the wrong thing.

- **Don't skip sandbox validation.** Every file path must go through `resolveAndValidatePath()` + deny-list checks. Even though these are "safe" tools, they still read/write the filesystem.

- **Don't return entire large files.** A 500MB CSV will blow up the agent's context. Always paginate large files and return metadata (row count, columns) so the agent can make informed requests.

- **Don't bundle unused format libraries.** Only import libraries lazily when the tool is called (`await import('xlsx')`). This avoids loading 5MB of xlsx code for agents that only need CSV.

- **Don't treat file tools as code execution.** These tools don't need human approval, don't need a remote sandbox, and don't need timeout enforcement beyond basic parse timeouts. Over-securing them adds friction to the 90% case that's perfectly safe.

- **Don't use `run_code` when an n8n workflow exists.** If the agent needs to send an email, query a database, call an API, or use a third-party library — it should use `execute_workflow` to run an existing n8n workflow. n8n has 400+ integrations. The remote code sandbox is for custom computation only, not for reimplementing what n8n nodes already do.

- **Don't inject ANY Node.js API into the JS sandbox.** Not `Buffer`, not `setTimeout`, not even `TextEncoder`. Every injected API is attack surface. The sandbox must remain a pure computation engine.

## Patterns to Follow

- **LangChain tool wrapping**: Follow `electron/agent/tool-definitions.ts` `mcpTool()` pattern.

- **Sandbox path validation**: Follow `electron/skill-loader.ts:255-276` pattern for path resolution and traversal protection.

- **Lazy imports**: Use `await import('xlsx')` to load libraries on first use, not at module load time. Follows the pattern in `deep-agents-runner.ts:116` for lazy ESM imports.

- **Error handling**: Return descriptive error strings to the agent (not throw) so it can recover: "Failed to parse invoice.xlsx: Sheet 'Q4' not found. Available sheets: Sales, Expenses, Summary."

- **IPC handlers**: Follow `electron/ipc/storage.ts` pattern for file tool IPC channels.
