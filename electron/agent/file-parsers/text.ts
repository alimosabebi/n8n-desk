import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ReadTextResult {
  success: true
  content: string
  sizeBytes: number
  lineCount: number
}

export interface WriteTextResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'read_error' | 'write_error'
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read a text file from disk and return its content.
 *
 * - Checks file size before reading (100 MB limit).
 * - Returns structured result with content, size, and line count.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the text file (must already be sandbox-validated)
 * @param encoding - Character encoding (defaults to 'utf-8')
 */
export async function readText(
  filePath: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<ReadTextResult | FileParserError> {
  try {
    // Check file size before reading
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `File too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    const content = await fs.readFile(filePath, { encoding })
    const lineCount = content.split('\n').length

    return {
      success: true,
      content,
      sizeBytes: stat.size,
      lineCount,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read text file: ${message}`,
      type: 'read_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write text content to a file on disk.
 *
 * - Checks content size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns the number of bytes written.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param content - Text content to write
 * @param encoding - Character encoding (defaults to 'utf-8')
 */
export async function writeText(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<WriteTextResult | FileParserError> {
  try {
    // Check content size before writing
    const sizeBytes = Buffer.byteLength(content, encoding)
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Content too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, content, { encoding })

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write text file: ${message}`,
      type: 'write_error',
    }
  }
}
