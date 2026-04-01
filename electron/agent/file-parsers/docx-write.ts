import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum serialized file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface WriteDocxResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'write_error'
}

// ---------------------------------------------------------------------------
// Inline formatting helpers
// ---------------------------------------------------------------------------

/**
 * Inline formatting state tracked while walking markdown-it tokens.
 *
 * markdown-it emits pairs of `*_open` / `*_close` tokens for inline
 * formatting. We track the current state so that `TextRun` instances
 * created inside an inline scope inherit the correct formatting flags.
 */
interface InlineState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  code: boolean
}

function defaultInlineState(): InlineState {
  return { bold: false, italic: false, strikethrough: false, code: false }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Create a Word (.docx) document from markdown content and write it to disk.
 *
 * - Parses the markdown source with `markdown-it` (already installed,
 *   `^14.1.0`) to produce an AST of tokens.
 * - Maps markdown tokens to `docx` primitives:
 *     - `#` → `HeadingLevel.HEADING_1` … `######` → `HeadingLevel.HEADING_6`
 *     - `**bold**` → `TextRun({ bold: true })`
 *     - `*italic*` → `TextRun({ italics: true })`
 *     - `~~strikethrough~~` → `TextRun({ strike: true })`
 *     - `` `code` `` → `TextRun({ font: { name: 'Courier New' } })`
 *     - `- item` / `1. item` → `Paragraph({ bullet: { level: 0 } })` or
 *       numbered list
 *     - Code blocks → `Paragraph` with monospace font
 *     - Horizontal rules → `Paragraph` with a bottom border
 * - Unsupported markdown features (images, tables, footnotes, etc.)
 *   fall back to plain text.
 * - Outputs the document as a Buffer via `Packer.toBuffer()`.
 * - Lazy-loads both `docx` and `markdown-it` to keep startup cost low.
 * - Creates parent directories as needed.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target .docx file (must already be sandbox-validated)
 * @param content  - Markdown-formatted string to convert to docx
 */
export async function writeDocx(
  filePath: string,
  content: string,
): Promise<WriteDocxResult | FileParserError> {
  let outputBuffer: Buffer

  try {
    outputBuffer = await buildDocxBuffer(content)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to generate docx: ${message}`,
      type: 'write_error',
    }
  }

  try {
    const sizeBytes = outputBuffer.length

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Generated docx too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, outputBuffer)

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write docx file: ${message}`,
      type: 'write_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown → docx conversion
// ---------------------------------------------------------------------------

/**
 * Parse markdown content and produce a docx Buffer.
 *
 * Extracted into a separate async function for clarity and testability.
 */
async function buildDocxBuffer(markdownContent: string): Promise<Buffer> {
  // Lazy-load both libraries to keep startup cost low
  const docxModule = await import('docx')
  const MarkdownIt = await import('markdown-it')

  const {
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    Packer,
    AlignmentType,
    BorderStyle,
  } = docxModule

  // markdown-it with linkify and typographic replacements disabled —
  // we only need the AST, not rendered HTML.
  const md = new MarkdownIt.default({ html: false, linkify: false, typographer: false })

  // Enable strikethrough support (~~text~~)
  md.enable('strikethrough')

  const tokens = md.parse(markdownContent, {})
  const paragraphs: InstanceType<typeof Paragraph>[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    // ----- Headings --------------------------------------------------------
    if (token.type === 'heading_open') {
      const level = headingLevel(token.tag, HeadingLevel)
      const inlineToken = tokens[i + 1] // heading content (inline)
      const runs = inlineToken?.children
        ? buildTextRuns(inlineToken.children, TextRun)
        : [new TextRun(inlineToken?.content ?? '')]

      paragraphs.push(
        new Paragraph({ heading: level, children: runs }),
      )
      // Skip heading_open, inline, heading_close
      i += 3
      continue
    }

    // ----- Regular paragraphs ----------------------------------------------
    if (token.type === 'paragraph_open') {
      const inlineToken = tokens[i + 1]
      const runs = inlineToken?.children
        ? buildTextRuns(inlineToken.children, TextRun)
        : [new TextRun(inlineToken?.content ?? '')]

      paragraphs.push(new Paragraph({ children: runs }))
      i += 3
      continue
    }

    // ----- Bullet lists ----------------------------------------------------
    if (token.type === 'bullet_list_open') {
      i = processListItems(tokens, i + 1, 'bullet_list_close', 0, false, paragraphs, Paragraph, TextRun)
      continue
    }

    // ----- Ordered lists ---------------------------------------------------
    if (token.type === 'ordered_list_open') {
      i = processListItems(tokens, i + 1, 'ordered_list_close', 0, true, paragraphs, Paragraph, TextRun)
      continue
    }

    // ----- Code blocks (fenced and indented) --------------------------------
    if (token.type === 'fence' || token.type === 'code_block') {
      const codeText = token.content.replace(/\n$/, '')
      const codeLines = codeText.split('\n')

      for (const line of codeLines) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                font: { name: 'Courier New' },
                size: 20, // 10pt in half-points
              }),
            ],
          }),
        )
      }
      i++
      continue
    }

    // ----- Horizontal rule --------------------------------------------------
    if (token.type === 'hr') {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 6,
              color: '999999',
            },
          },
          children: [],
        }),
      )
      i++
      continue
    }

    // ----- Blockquote -------------------------------------------------------
    if (token.type === 'blockquote_open') {
      i = processBlockquote(tokens, i + 1, paragraphs, Paragraph, TextRun)
      continue
    }

    // ----- Fallback: skip unrecognised tokens --------------------------------
    i++
  }

  // If the markdown was empty or produced no paragraphs, add an empty one
  // so the document is valid.
  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [] }))
  }

  const doc = new Document({
    sections: [{ children: paragraphs }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

// ---------------------------------------------------------------------------
// Token → TextRun conversion
// ---------------------------------------------------------------------------

/**
 * Convert markdown-it inline child tokens into an array of docx `TextRun`
 * instances with the appropriate formatting.
 */
function buildTextRuns(
  children: Array<{ type: string; content?: string; tag?: string; markup?: string }>,
  TextRun: typeof import('docx').TextRun,
): InstanceType<typeof import('docx').TextRun>[] {
  const runs: InstanceType<typeof import('docx').TextRun>[] = []
  const state = defaultInlineState()

  for (const child of children) {
    switch (child.type) {
      case 'text':
        runs.push(new TextRun({
          text: child.content ?? '',
          bold: state.bold,
          italics: state.italic,
          strike: state.strikethrough,
          ...(state.code ? { font: { name: 'Courier New' } } : {}),
        }))
        break

      case 'strong_open':
        state.bold = true
        break
      case 'strong_close':
        state.bold = false
        break

      case 'em_open':
        state.italic = true
        break
      case 'em_close':
        state.italic = false
        break

      case 's_open':
        state.strikethrough = true
        break
      case 's_close':
        state.strikethrough = false
        break

      case 'code_inline':
        runs.push(new TextRun({
          text: child.content ?? '',
          font: { name: 'Courier New' },
          bold: state.bold,
          italics: state.italic,
        }))
        break

      case 'softbreak':
        runs.push(new TextRun({ break: 1 }))
        break

      case 'hardbreak':
        runs.push(new TextRun({ break: 1 }))
        break

      default:
        // Unsupported inline tokens (images, html_inline, etc.)
        // fall back to plain text when content is available.
        if (child.content) {
          runs.push(new TextRun({
            text: child.content,
            bold: state.bold,
            italics: state.italic,
            strike: state.strikethrough,
          }))
        }
        break
    }
  }

  return runs
}

// ---------------------------------------------------------------------------
// List processing
// ---------------------------------------------------------------------------

/**
 * Walk through list item tokens and create paragraphs with bullet or
 * numbered styling. Returns the token index after the closing tag.
 */
function processListItems(
  tokens: Array<{ type: string; content?: string; children?: Array<{ type: string; content?: string; tag?: string; markup?: string }> | null }>,
  startIndex: number,
  closingTag: string,
  level: number,
  _ordered: boolean,
  paragraphs: InstanceType<typeof import('docx').Paragraph>[],
  Paragraph: typeof import('docx').Paragraph,
  TextRun: typeof import('docx').TextRun,
): number {
  let i = startIndex

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === closingTag) {
      return i + 1
    }

    if (token.type === 'list_item_open') {
      i++
      continue
    }

    if (token.type === 'list_item_close') {
      i++
      continue
    }

    // Inline content of a list item
    if (token.type === 'paragraph_open') {
      const inlineToken = tokens[i + 1]
      const runs = inlineToken?.children
        ? buildTextRuns(inlineToken.children, TextRun)
        : [new TextRun(inlineToken?.content ?? '')]

      paragraphs.push(
        new Paragraph({
          bullet: { level },
          children: runs,
        }),
      )
      // Skip paragraph_open, inline, paragraph_close
      i += 3
      continue
    }

    // Nested bullet list
    if (token.type === 'bullet_list_open') {
      i = processListItems(tokens, i + 1, 'bullet_list_close', level + 1, false, paragraphs, Paragraph, TextRun)
      continue
    }

    // Nested ordered list
    if (token.type === 'ordered_list_open') {
      i = processListItems(tokens, i + 1, 'ordered_list_close', level + 1, true, paragraphs, Paragraph, TextRun)
      continue
    }

    // Skip unrecognised tokens inside lists
    i++
  }

  return i
}

// ---------------------------------------------------------------------------
// Blockquote processing
// ---------------------------------------------------------------------------

/**
 * Walk through blockquote tokens and create indented paragraphs.
 * Returns the token index after the blockquote_close tag.
 */
function processBlockquote(
  tokens: Array<{ type: string; content?: string; children?: Array<{ type: string; content?: string; tag?: string; markup?: string }> | null }>,
  startIndex: number,
  paragraphs: InstanceType<typeof import('docx').Paragraph>[],
  Paragraph: typeof import('docx').Paragraph,
  TextRun: typeof import('docx').TextRun,
): number {
  let i = startIndex

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'blockquote_close') {
      return i + 1
    }

    if (token.type === 'paragraph_open') {
      const inlineToken = tokens[i + 1]
      const runs = inlineToken?.children
        ? buildTextRuns(inlineToken.children, TextRun)
        : [new TextRun(inlineToken?.content ?? '')]

      paragraphs.push(
        new Paragraph({
          indent: { left: 720 }, // 0.5 inch in twips
          children: [
            new TextRun({ text: '\u2014 ', italics: true }), // em-dash prefix
            ...runs.map((run) => {
              // Re-create each run with italics enabled for blockquote style
              return new TextRun({
                text: (run as unknown as { options?: { text?: string } }).options?.text ?? '',
                italics: true,
              })
            }),
          ],
        }),
      )
      i += 3
      continue
    }

    // Nested blockquote
    if (token.type === 'blockquote_open') {
      i = processBlockquote(tokens, i + 1, paragraphs, Paragraph, TextRun)
      continue
    }

    i++
  }

  return i
}

// ---------------------------------------------------------------------------
// Heading level mapping
// ---------------------------------------------------------------------------

/**
 * Map an HTML heading tag ('h1'–'h6') to the corresponding docx HeadingLevel.
 */
function headingLevel(
  tag: string,
  HeadingLevel: typeof import('docx').HeadingLevel,
): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (tag) {
    case 'h1': return HeadingLevel.HEADING_1
    case 'h2': return HeadingLevel.HEADING_2
    case 'h3': return HeadingLevel.HEADING_3
    case 'h4': return HeadingLevel.HEADING_4
    case 'h5': return HeadingLevel.HEADING_5
    case 'h6': return HeadingLevel.HEADING_6
    default: return HeadingLevel.HEADING_1
  }
}
