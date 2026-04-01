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

export interface PdfPageData {
  pageNum: number
  text: string
}

export interface ReadPdfResult {
  success: true
  text: string
  pageCount: number
  metadata: Record<string, unknown>
  pages: PdfPageData[]
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'parse_error' | 'read_error' | 'timeout'
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReadPdfOptions {
  /**
   * Page range filter.
   *
   * Accepts formats like:
   * - `"3"` — single page
   * - `"1-5"` — inclusive range
   * - `"2,4,6"` — specific pages
   * - `"1-3,7,10-12"` — mixed ranges and individual pages
   *
   * Pages are 1-indexed. Out-of-range pages are silently skipped.
   */
  pages?: string
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

/**
 * Parse a page range string into a Set of 1-indexed page numbers.
 *
 * Returns `null` when no filtering is needed (all pages requested).
 */
function parsePageRange(pages: string | undefined): Set<number> | null {
  if (!pages || pages.trim() === '') {
    return null
  }

  const result = new Set<number>()
  const parts = pages.split(',')

  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed === '') continue

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-', 2)
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)

      if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
        continue // Skip invalid range segments silently
      }

      for (let i = start; i <= end; i++) {
        result.add(i)
      }
    } else {
      const num = parseInt(trimmed, 10)
      if (!isNaN(num) && num >= 1) {
        result.add(num)
      }
    }
  }

  return result.size > 0 ? result : null
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and extract text from a PDF file.
 *
 * - Checks file size before reading (100 MB limit).
 * - Lazy-loads `pdf-parse` v1.1.1 to avoid loading the library for agents
 *   that don't need PDF support.
 * - Supports page range filtering via `options.pages`.
 * - Uses a custom `pagerender` callback to track per-page text and filter
 *   by page number when a range is specified.
 * - Wraps parsing in a 30 s timeout to catch malformed PDFs that hang.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the PDF file (must already be sandbox-validated)
 * @param options  - Read options (page range)
 */
export async function readPdf(
  filePath: string,
  options: ReadPdfOptions = {},
): Promise<ReadPdfResult | FileParserError> {
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
      error: `Failed to read PDF file: ${message}`,
      type: 'read_error',
    }
  }

  try {
    const result = await withTimeout(
      parsePdfBuffer(buffer, options),
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
      error: `Failed to parse PDF: ${message}`,
      type: 'parse_error',
    }
  }
}

/**
 * Parse a PDF buffer using pdf-parse with per-page text tracking.
 *
 * Extracted into a separate async function so it can be wrapped with a timeout.
 */
async function parsePdfBuffer(
  buffer: Buffer,
  options: ReadPdfOptions,
): Promise<Omit<ReadPdfResult, 'sizeBytes'>> {
  // Lazy-load pdf-parse to avoid loading the library for agents that don't need PDF
  const pdfParse = await import('pdf-parse')

  const pageFilter = parsePageRange(options.pages)
  const collectedPages: PdfPageData[] = []
  let currentPageNum = 0

  // Custom pagerender callback to collect per-page text and support filtering.
  // pdf-parse calls this for each page in order, passing the page data object
  // from pdfjs-dist. We extract text content and track page numbers.
  const pagerender = async (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }): Promise<string> => {
    currentPageNum++
    const textContent = await pageData.getTextContent()
    const pageText = textContent.items
      .map((item: { str: string }) => item.str)
      .join(' ')

    // Always collect the page data — we filter afterwards
    collectedPages.push({
      pageNum: currentPageNum,
      text: pageText,
    })

    // Return the text for pdf-parse to accumulate into data.text
    // If filtering, return empty for excluded pages so data.text only
    // contains the filtered content
    if (pageFilter && !pageFilter.has(currentPageNum)) {
      return ''
    }

    return pageText
  }

  const data = await pdfParse.default(buffer, { pagerender })

  // Filter collected pages to only the requested range
  const filteredPages = pageFilter
    ? collectedPages.filter((p) => pageFilter.has(p.pageNum))
    : collectedPages

  // Build the combined text from filtered pages
  const filteredText = pageFilter
    ? filteredPages.map((p) => p.text).join('\n\n')
    : data.text

  // Extract metadata from the pdf-parse result
  const metadata: Record<string, unknown> = {}
  if (data.info) {
    // data.info contains PDF document info (Author, Title, CreationDate, etc.)
    for (const [key, value] of Object.entries(data.info as Record<string, unknown>)) {
      metadata[key] = value
    }
  }
  if (data.metadata) {
    // data.metadata contains XMP metadata when available
    metadata['_xmp'] = data.metadata
  }

  return {
    success: true,
    text: filteredText,
    pageCount: data.numpages,
    metadata,
    pages: filteredPages,
  }
}
