import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

/** Default indentation for pretty-printed JSON output. */
const DEFAULT_INDENT = 2

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ReadJsonResult {
  success: true
  data: unknown
  sizeBytes: number
}

export interface WriteJsonResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'parse_error' | 'read_error' | 'write_error'
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file from disk.
 *
 * - Checks file size before reading (100 MB limit).
 * - Parses JSON with descriptive error messages for malformed content.
 * - Returns the parsed data as an `unknown` value for type-safe consumption.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the JSON file (must already be sandbox-validated)
 */
export async function readJson(
  filePath: string,
): Promise<ReadJsonResult | FileParserError> {
  let rawContent: string
  let sizeBytes: number

  try {
    // Check file size before reading
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

    rawContent = await fs.readFile(filePath, { encoding: 'utf-8' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read JSON file: ${message}`,
      type: 'read_error',
    }
  }

  // Parse JSON separately so we can distinguish parse errors from I/O errors
  try {
    const data: unknown = JSON.parse(rawContent)
    return {
      success: true,
      data,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Malformed JSON: ${message}`,
      type: 'parse_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface WriteJsonOptions {
  /** Whether to pretty-print the output (default: true). */
  pretty?: boolean
  /** Number of spaces for indentation when pretty-printing (default: 2). */
  indent?: number
}

/**
 * Serialize data as JSON and write to a file on disk.
 *
 * - Serializes with optional pretty-printing (enabled by default).
 * - Checks serialized size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param data - Data to serialize as JSON
 * @param options - Write options (pretty-print, indent size)
 */
export async function writeJson(
  filePath: string,
  data: unknown,
  options: WriteJsonOptions = {},
): Promise<WriteJsonResult | FileParserError> {
  const { pretty = true, indent = DEFAULT_INDENT } = options

  let serialized: string
  try {
    serialized = pretty
      ? JSON.stringify(data, null, indent) + '\n'
      : JSON.stringify(data) + '\n'
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to serialize data as JSON: ${message}`,
      type: 'write_error',
    }
  }

  try {
    const sizeBytes = Buffer.byteLength(serialized, 'utf-8')
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Serialized JSON too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, serialized, { encoding: 'utf-8' })

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write JSON file: ${message}`,
      type: 'write_error',
    }
  }
}
