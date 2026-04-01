import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

/** Timeout for parse operations (30 seconds). */
const PARSE_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DocxParagraph {
  text: string
  style: string
}

export interface ReadDocxResult {
  success: true
  text: string
  paragraphs: DocxParagraph[]
  metadata: Record<string, unknown>
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'parse_error' | 'read_error' | 'timeout'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a promise with a timeout. Rejects with a timeout error if the
 * promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Parse operation timed out (${ms / 1000}s limit)`)),
      ms,
    )
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and extract text from a Word (.docx) file.
 *
 * - Checks file size before reading (100 MB limit).
 * - Lazy-loads `mammoth` to avoid loading the library for agents that
 *   don't need docx support.
 * - Extracts raw text via `mammoth.extractRawText()` for the full plain
 *   text content.
 * - Also runs `mammoth.convertToHtml()` to derive paragraph structure
 *   and style information (headings, lists, etc.).
 * - Wraps parsing in a 30 s timeout to catch malformed files that hang.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the .docx file (must already be sandbox-validated)
 */
export async function readDocx(
  filePath: string,
): Promise<ReadDocxResult | FileParserError> {
  let buffer: Buffer
  let sizeBytes: number

  try {
    const stat = await fs.stat(filePath)
    sizeBytes = stat.size

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `File too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    buffer = await fs.readFile(filePath)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read docx file: ${message}`,
      type: 'read_error',
    }
  }

  try {
    const result = await withTimeout(
      parseDocxBuffer(buffer),
      PARSE_TIMEOUT_MS,
    )
    return {
      ...result,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('timed out')) {
      return {
        success: false,
        error: message,
        type: 'timeout',
      }
    }
    return {
      success: false,
      error: `Failed to parse docx: ${message}`,
      type: 'parse_error',
    }
  }
}

/**
 * Parse a docx buffer using mammoth, extracting both plain text and
 * paragraph structure.
 *
 * Extracted into a separate async function so it can be wrapped with a timeout.
 */
async function parseDocxBuffer(
  buffer: Buffer,
): Promise<Omit<ReadDocxResult, 'sizeBytes'>> {
  // Lazy-load mammoth to avoid loading the library for agents that don't need docx
  const mammoth = await import('mammoth')

  // Extract raw text for the full plain-text content
  const rawResult = await mammoth.extractRawText({ buffer })
  const text = rawResult.value

  // Convert to HTML to derive paragraph structure and styles.
  // mammoth outputs semantic HTML (<h1>, <p>, <li>, etc.) which lets us
  // identify headings, lists, and other structural elements.
  const htmlResult = await mammoth.convertToHtml({ buffer })
  const paragraphs = extractParagraphs(htmlResult.value)

  // Mammoth does not expose document metadata (author, title, etc.)
  // directly. We populate an empty metadata object; callers can extend
  // this later if they parse the underlying XML themselves.
  const metadata: Record<string, unknown> = {}

  // Include any mammoth conversion warnings as metadata
  if (htmlResult.messages.length > 0) {
    metadata['_warnings'] = htmlResult.messages.map((m) => m.message)
  }

  return {
    success: true,
    text,
    paragraphs,
    metadata,
  }
}

// ---------------------------------------------------------------------------
// HTML paragraph extraction helpers
// ---------------------------------------------------------------------------

/**
 * Supported HTML tag → style mappings for paragraph extraction.
 */
const TAG_TO_STYLE: Record<string, string> = {
  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  h4: 'heading4',
  h5: 'heading5',
  h6: 'heading6',
  p: 'paragraph',
  li: 'listItem',
}

/**
 * Extract paragraph-level blocks from mammoth's HTML output.
 *
 * Uses simple regex-based parsing (mammoth outputs clean, predictable
 * HTML) to avoid pulling in a full DOM parser. Each block-level element
 * becomes a `DocxParagraph` with its text content and inferred style.
 */
function extractParagraphs(html: string): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = []

  // Match block-level elements: <h1>…</h1>, <p>…</p>, <li>…</li>
  // Mammoth output is flat (no nested block elements) so a simple
  // non-greedy match is sufficient.
  const blockRegex = /<(h[1-6]|p|li)(?:\s[^>]*)?>(.+?)<\/\1>/gs
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase()
    const innerHtml = match[2]

    // Strip inline HTML tags to get plain text
    const text = innerHtml.replace(/<[^>]+>/g, '').trim()

    if (text.length > 0) {
      paragraphs.push({
        text,
        style: TAG_TO_STYLE[tag] ?? 'paragraph',
      })
    }
  }

  return paragraphs
}
