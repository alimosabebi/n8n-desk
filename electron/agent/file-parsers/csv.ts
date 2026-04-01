import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

/** Row threshold for pagination — files with more rows return metadata + first N rows. */
const PAGINATION_ROW_LIMIT = 100

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ReadCsvResult {
  success: true
  headers: string[]
  rows: Record<string, unknown>[]
  totalRows: number
  truncated: boolean
  sizeBytes: number
  delimiter: string
}

export interface WriteCsvResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'parse_error' | 'read_error' | 'write_error' | 'timeout'
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReadCsvOptions {
  /** Override auto-detected delimiter. */
  delimiter?: string
  /** Whether the first row is a header row (default: true). */
  header?: boolean
  /** Maximum number of rows to return (default: 100 for large files). */
  maxRows?: number
  /** Character encoding (default: 'utf-8'). */
  encoding?: BufferEncoding
}

export interface WriteCsvOptions {
  /** Delimiter character (default: ','). */
  delimiter?: string
  /** Whether to include headers (default: true). */
  header?: boolean
  /** Character encoding (default: 'utf-8'). */
  encoding?: BufferEncoding
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and parse a CSV file from disk.
 *
 * - Checks file size before reading (100 MB limit).
 * - Uses PapaParse with `dynamicTyping` and `skipEmptyLines` for clean output.
 * - Auto-detects delimiter when not specified.
 * - Returns paginated results for large files (first 100 rows + total count).
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the CSV file (must already be sandbox-validated)
 * @param options  - Read options (delimiter override, header, maxRows, encoding)
 */
export async function readCsv(
  filePath: string,
  options: ReadCsvOptions = {},
): Promise<ReadCsvResult | FileParserError> {
  const {
    delimiter,
    header = true,
    maxRows = PAGINATION_ROW_LIMIT,
    encoding = 'utf-8',
  } = options

  let rawContent: string
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

    rawContent = await fs.readFile(filePath, { encoding })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read CSV file: ${message}`,
      type: 'read_error',
    }
  }

  try {
    // Lazy-load papaparse to avoid loading ~200KB for agents that don't need CSV
    const Papa = await import('papaparse')

    const parseResult = Papa.parse(rawContent, {
      header,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimiter: delimiter ?? undefined,
    })

    if (parseResult.errors.length > 0) {
      // Filter to critical errors (missing quotes, etc.) — row-level warnings are okay
      const criticalErrors = parseResult.errors.filter(
        (e: { type: string; row?: number; message: string }) =>
          e.type === 'Quotes' || e.type === 'FieldMismatch',
      )
      if (criticalErrors.length > 0 && parseResult.data.length === 0) {
        const firstError = criticalErrors[0]
        return {
          success: false,
          error: `Malformed CSV at row ${firstError.row}: ${firstError.message}`,
          type: 'parse_error',
        }
      }
    }

    const allRows = parseResult.data as Record<string, unknown>[]
    const totalRows = allRows.length
    const truncated = totalRows > maxRows
    const rows = truncated ? allRows.slice(0, maxRows) : allRows

    // Derive headers from meta or first row keys
    const headers: string[] = header
      ? (parseResult.meta.fields ?? [])
      : []

    const detectedDelimiter = parseResult.meta.delimiter ?? ','

    return {
      success: true,
      headers,
      rows,
      totalRows,
      truncated,
      sizeBytes,
      delimiter: detectedDelimiter,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to parse CSV: ${message}`,
      type: 'parse_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Serialize data as CSV and write to a file on disk.
 *
 * - Uses PapaParse `unparse()` with `escapeFormulae: true` for CSV injection protection.
 * - Checks serialized size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param data     - Array of row objects (or array of arrays) to serialize
 * @param options  - Write options (delimiter, header, encoding)
 */
export async function writeCsv(
  filePath: string,
  data: Record<string, unknown>[] | unknown[][],
  options: WriteCsvOptions = {},
): Promise<WriteCsvResult | FileParserError> {
  const {
    delimiter = ',',
    header = true,
    encoding = 'utf-8',
  } = options

  let serialized: string

  try {
    // Lazy-load papaparse
    const Papa = await import('papaparse')

    serialized = Papa.unparse(data as Record<string, unknown>[], {
      delimiter,
      header,
      escapeFormulae: true,
    })

    // Ensure trailing newline
    if (!serialized.endsWith('\n')) {
      serialized += '\n'
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to serialize data as CSV: ${message}`,
      type: 'write_error',
    }
  }

  try {
    const sizeBytes = Buffer.byteLength(serialized, encoding)

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Serialized CSV too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, serialized, { encoding })

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write CSV file: ${message}`,
      type: 'write_error',
    }
  }
}
