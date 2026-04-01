import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ReadYamlResult {
  success: true
  data: unknown
  sizeBytes: number
}

export interface WriteYamlResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'parse_error' | 'read_error' | 'write_error'
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WriteYamlOptions {
  /** Number of spaces for indentation (default: 2). */
  indent?: number
  /** Line width before wrapping (default: 80). */
  lineWidth?: number
  /** Whether to sort object keys alphabetically (default: false). */
  sortKeys?: boolean
  /** Character encoding (default: 'utf-8'). */
  encoding?: BufferEncoding
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and parse a YAML file from disk.
 *
 * - Checks file size before reading (100 MB limit).
 * - Uses js-yaml `load()` which is the safe loader in v4+ (no prototype pollution).
 *   The `DEFAULT_SCHEMA` used by `load()` does NOT support `!!js/function`,
 *   `!!js/regexp`, or `!!js/undefined` — preventing code execution from YAML.
 * - Returns the parsed data as an `unknown` value for type-safe consumption.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the YAML file (must already be sandbox-validated)
 * @param encoding - Character encoding (defaults to 'utf-8')
 */
export async function readYaml(
  filePath: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<ReadYamlResult | FileParserError> {
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
      error: `Failed to read YAML file: ${message}`,
      type: 'read_error',
    }
  }

  try {
    // Lazy-load js-yaml to avoid loading the library for agents that don't need YAML
    const yaml = await import('js-yaml')

    // yaml.load() in js-yaml v4 is the safe loader (DEFAULT_SCHEMA).
    // It does NOT support dangerous types like !!js/function.
    const data: unknown = yaml.load(rawContent)

    return {
      success: true,
      data,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Malformed YAML: ${message}`,
      type: 'parse_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Serialize data as YAML and write to a file on disk.
 *
 * - Uses js-yaml `dump()` for serialization.
 * - Checks serialized size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param data     - Data to serialize as YAML
 * @param options  - Write options (indent, lineWidth, sortKeys, encoding)
 */
export async function writeYaml(
  filePath: string,
  data: unknown,
  options: WriteYamlOptions = {},
): Promise<WriteYamlResult | FileParserError> {
  const {
    indent = 2,
    lineWidth = 80,
    sortKeys = false,
    encoding = 'utf-8',
  } = options

  let serialized: string

  try {
    // Lazy-load js-yaml
    const yaml = await import('js-yaml')

    serialized = yaml.dump(data, {
      indent,
      lineWidth,
      sortKeys,
      noRefs: true,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to serialize data as YAML: ${message}`,
      type: 'write_error',
    }
  }

  try {
    const sizeBytes = Buffer.byteLength(serialized, encoding)

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Serialized YAML too large (${sizeMB}MB). Maximum is 100MB.`,
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
      error: `Failed to write YAML file: ${message}`,
      type: 'write_error',
    }
  }
}
