import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'

import { readPdf } from '../pdf'
import type { ReadPdfResult, FileParserError } from '../pdf'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-test-'))
  tmpDir = await fs.realpath(rawTmp)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/**
 * Resolve the path to the pdf-parse test data directory.
 * pdf-parse ships with real PDF fixtures in its test/data/ folder.
 */
function pdfParseTestDataDir(): string {
  // Walk up from this test file to find node_modules
  const rootDir = path.resolve(__dirname, '..', '..', '..', '..')
  return path.join(rootDir, 'node_modules', 'pdf-parse', 'test', 'data')
}

/**
 * Copy a pdf-parse test fixture to our tmpDir and return the path.
 * This ensures readPdf reads from an isolated temporary path.
 */
async function copyTestPdf(filename: string): Promise<string> {
  const src = path.join(pdfParseTestDataDir(), filename)
  const dest = path.join(tmpDir, filename)
  await fs.copyFile(src, dest)
  return dest
}

// ---------------------------------------------------------------------------
// Basic text extraction
// ---------------------------------------------------------------------------

describe('PDF text extraction', () => {
  it('extracts text from a valid PDF', async () => {
    // 01-valid.pdf is a 14-page academic paper included with pdf-parse
    const filePath = await copyTestPdf('01-valid.pdf')

    const result = await readPdf(filePath)
    expect(result.success).toBe(true)

    const pdf = result as ReadPdfResult
    expect(pdf.pageCount).toBe(14)
    expect(pdf.text.length).toBeGreaterThan(100)
    expect(pdf.pages).toHaveLength(14)
    expect(pdf.pages[0].pageNum).toBe(1)
    expect(pdf.pages[0].text.length).toBeGreaterThan(0)
    expect(pdf.sizeBytes).toBeGreaterThan(0)
  })

  it('extracts text from another valid PDF', async () => {
    // 02-valid.pdf is another test fixture with different content
    const filePath = await copyTestPdf('02-valid.pdf')

    const result = await readPdf(filePath) as ReadPdfResult
    expect(result.success).toBe(true)
    expect(result.pageCount).toBeGreaterThan(0)
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.pages.length).toBe(result.pageCount)
  })

  it('returns metadata from PDF with info', async () => {
    const filePath = await copyTestPdf('01-valid.pdf')

    const result = await readPdf(filePath) as ReadPdfResult
    expect(result.metadata).toBeDefined()
    expect(typeof result.metadata).toBe('object')
    // 01-valid.pdf has Creator and Producer metadata
    expect(result.metadata['Creator']).toBeDefined()
  })

  it('returns per-page data with correct page numbers', async () => {
    const filePath = await copyTestPdf('01-valid.pdf')

    const result = await readPdf(filePath) as ReadPdfResult
    // Pages should be numbered sequentially starting at 1
    for (let i = 0; i < result.pages.length; i++) {
      expect(result.pages[i].pageNum).toBe(i + 1)
    }
  })
})

// ---------------------------------------------------------------------------
// Page range filtering
// ---------------------------------------------------------------------------

describe('PDF page range filtering', () => {
  // Use the 14-page test PDF for page range tests
  async function getTestPdf(): Promise<string> {
    return copyTestPdf('01-valid.pdf')
  }

  it('filters to a single page', async () => {
    const filePath = await getTestPdf()

    const result = await readPdf(filePath, { pages: '3' }) as ReadPdfResult
    expect(result.pageCount).toBe(14) // total pages unchanged
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].pageNum).toBe(3)
    expect(result.pages[0].text.length).toBeGreaterThan(0)
  })

  it('filters to a page range', async () => {
    const filePath = await getTestPdf()

    const result = await readPdf(filePath, { pages: '2-4' }) as ReadPdfResult
    expect(result.pages).toHaveLength(3)
    expect(result.pages.map((p) => p.pageNum)).toEqual([2, 3, 4])

    // Filtered text should only contain content from pages 2-4
    const fullResult = await readPdf(filePath) as ReadPdfResult
    // The filtered text should be shorter than the full text
    expect(result.text.length).toBeLessThan(fullResult.text.length)
  })

  it('filters with comma-separated pages', async () => {
    const filePath = await getTestPdf()

    const result = await readPdf(filePath, { pages: '1,5,10' }) as ReadPdfResult
    expect(result.pages).toHaveLength(3)
    expect(result.pages.map((p) => p.pageNum)).toEqual([1, 5, 10])
  })

  it('filters with mixed ranges and individual pages', async () => {
    const filePath = await getTestPdf()

    const result = await readPdf(filePath, { pages: '1-3,7,12-14' }) as ReadPdfResult
    expect(result.pages).toHaveLength(7) // pages 1,2,3,7,12,13,14
    expect(result.pages.map((p) => p.pageNum)).toEqual([1, 2, 3, 7, 12, 13, 14])
  })

  it('silently skips out-of-range pages', async () => {
    const filePath = await getTestPdf()

    // 01-valid.pdf has 14 pages; request pages 12-20
    const result = await readPdf(filePath, { pages: '12-20' }) as ReadPdfResult
    // Only pages 12, 13, 14 exist
    expect(result.pages).toHaveLength(3)
    expect(result.pages.map((p) => p.pageNum)).toEqual([12, 13, 14])
  })

  it('returns all pages when no filter is specified', async () => {
    const filePath = await getTestPdf()

    const result = await readPdf(filePath) as ReadPdfResult
    expect(result.pages).toHaveLength(14)
  })

  it('returns all pages when pages is empty string', async () => {
    const filePath = await getTestPdf()

    const result = await readPdf(filePath, { pages: '' }) as ReadPdfResult
    expect(result.pages).toHaveLength(14)
  })

  it('filtered text does not contain content from excluded pages', async () => {
    const filePath = await getTestPdf()

    // Get text from page 1 only
    const page1Result = await readPdf(filePath, { pages: '1' }) as ReadPdfResult
    // Get text from page 14 only
    const page14Result = await readPdf(filePath, { pages: '14' }) as ReadPdfResult

    // Page 1 text should not appear in page 14 result (they have different content)
    // We check that at least some text from page 1 is absent from page 14
    const page1Words = page1Result.pages[0].text.split(/\s+/).filter((w) => w.length > 8)
    const page14Text = page14Result.text

    // At least some unique long words from page 1 should not be in page 14
    const uniqueToPage1 = page1Words.filter((w) => !page14Text.includes(w))
    expect(uniqueToPage1.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('PDF error handling', () => {
  it('returns read_error for non-existent file', async () => {
    const result = await readPdf(path.join(tmpDir, 'missing.pdf'))
    expect(result.success).toBe(false)
    expect((result as FileParserError).type).toBe('read_error')
  })

  it('returns parse_error for corrupted file', async () => {
    const filePath = path.join(tmpDir, 'corrupt.pdf')
    await fs.writeFile(filePath, 'not a valid pdf')

    const result = await readPdf(filePath)
    expect(result.success).toBe(false)
    const error = result as FileParserError
    expect(error.type).toBe('parse_error')
    expect(error.error).toBeDefined()
  })

  it('returns sizeBytes in successful result', async () => {
    const filePath = await copyTestPdf('01-valid.pdf')

    const result = await readPdf(filePath) as ReadPdfResult
    expect(result.sizeBytes).toBeGreaterThan(0)
  })
})
