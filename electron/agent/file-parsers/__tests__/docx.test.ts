import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { readDocx } from '../docx-read'
import { writeDocx } from '../docx-write'
import type { ReadDocxResult, FileParserError as ReadError } from '../docx-read'
import type { WriteDocxResult, FileParserError as WriteError } from '../docx-write'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-test-'))
  tmpDir = await fs.realpath(rawTmp)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/**
 * Generate a minimal .docx file programmatically using the docx library.
 * This serves as a fixture generator for read tests.
 */
async function generateDocx(
  paragraphs: Array<{
    text: string
    heading?: 'h1' | 'h2' | 'h3'
    bold?: boolean
    italic?: boolean
    bullet?: boolean
  }>,
): Promise<Buffer> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx')

  const docParagraphs = paragraphs.map((p) => {
    const headingMap: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
      h1: HeadingLevel.HEADING_1,
      h2: HeadingLevel.HEADING_2,
      h3: HeadingLevel.HEADING_3,
    }

    return new Paragraph({
      ...(p.heading ? { heading: headingMap[p.heading] } : {}),
      ...(p.bullet ? { bullet: { level: 0 } } : {}),
      children: [
        new TextRun({
          text: p.text,
          bold: p.bold ?? false,
          italics: p.italic ?? false,
        }),
      ],
    })
  })

  const doc = new Document({
    sections: [{ children: docParagraphs }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

// ---------------------------------------------------------------------------
// Read paragraphs from generated docx
// ---------------------------------------------------------------------------

describe('Docx read', () => {
  it('extracts plain text from a simple document', async () => {
    const filePath = path.join(tmpDir, 'simple.docx')
    const buffer = await generateDocx([
      { text: 'Hello World' },
      { text: 'Second paragraph' },
    ])
    await fs.writeFile(filePath, buffer)

    const result = await readDocx(filePath)
    expect(result.success).toBe(true)

    const doc = result as ReadDocxResult
    expect(doc.text).toContain('Hello World')
    expect(doc.text).toContain('Second paragraph')
    expect(doc.sizeBytes).toBeGreaterThan(0)
  })

  it('detects heading styles from paragraphs', async () => {
    const filePath = path.join(tmpDir, 'headings.docx')
    const buffer = await generateDocx([
      { text: 'Main Title', heading: 'h1' },
      { text: 'Some body text' },
      { text: 'Section Header', heading: 'h2' },
      { text: 'More body text' },
    ])
    await fs.writeFile(filePath, buffer)

    const result = await readDocx(filePath) as ReadDocxResult
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(4)

    // Find the heading paragraphs
    const h1 = result.paragraphs.find((p) => p.text === 'Main Title')
    const h2 = result.paragraphs.find((p) => p.text === 'Section Header')
    const body = result.paragraphs.find((p) => p.text === 'Some body text')

    expect(h1).toBeDefined()
    expect(h1!.style).toBe('heading1')
    expect(h2).toBeDefined()
    expect(h2!.style).toBe('heading2')
    expect(body).toBeDefined()
    expect(body!.style).toBe('paragraph')
  })

  it('extracts text from list items', async () => {
    const filePath = path.join(tmpDir, 'lists.docx')
    const buffer = await generateDocx([
      { text: 'Item one', bullet: true },
      { text: 'Item two', bullet: true },
      { text: 'Item three', bullet: true },
    ])
    await fs.writeFile(filePath, buffer)

    const result = await readDocx(filePath) as ReadDocxResult
    expect(result.text).toContain('Item one')
    expect(result.text).toContain('Item two')
    expect(result.text).toContain('Item three')
  })

  it('returns metadata object', async () => {
    const filePath = path.join(tmpDir, 'meta.docx')
    const buffer = await generateDocx([{ text: 'Test' }])
    await fs.writeFile(filePath, buffer)

    const result = await readDocx(filePath) as ReadDocxResult
    expect(result.metadata).toBeDefined()
    expect(typeof result.metadata).toBe('object')
  })

  it('handles empty document', async () => {
    const filePath = path.join(tmpDir, 'empty.docx')
    const buffer = await generateDocx([])
    await fs.writeFile(filePath, buffer)

    const result = await readDocx(filePath) as ReadDocxResult
    expect(result.success).toBe(true)
    // Empty doc may have empty text
    expect(typeof result.text).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// Write from markdown content
// ---------------------------------------------------------------------------

describe('Docx write', () => {
  it('creates a valid docx from simple markdown', async () => {
    const filePath = path.join(tmpDir, 'from-md.docx')
    const markdown = '# Hello World\n\nThis is a paragraph.\n'

    const writeResult = await writeDocx(filePath, markdown)
    expect(writeResult.success).toBe(true)
    expect((writeResult as WriteDocxResult).sizeBytes).toBeGreaterThan(0)

    // Verify it's a valid docx by reading it back
    const readResult = await readDocx(filePath) as ReadDocxResult
    expect(readResult.text).toContain('Hello World')
    expect(readResult.text).toContain('This is a paragraph')
  })

  it('handles headings of different levels', async () => {
    const filePath = path.join(tmpDir, 'headings.docx')
    const markdown = [
      '# Heading 1',
      '## Heading 2',
      '### Heading 3',
      '#### Heading 4',
      '##### Heading 5',
      '###### Heading 6',
    ].join('\n\n')

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('Heading 1')
    expect(result.text).toContain('Heading 6')

    // Check that heading styles are detected
    const h1 = result.paragraphs.find((p) => p.text === 'Heading 1')
    expect(h1).toBeDefined()
    expect(h1!.style).toBe('heading1')
  })

  it('handles bold and italic formatting', async () => {
    const filePath = path.join(tmpDir, 'formatted.docx')
    const markdown = 'This has **bold** and *italic* text.\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    // The text should contain all words (formatting is in styling, not text)
    expect(result.text).toContain('bold')
    expect(result.text).toContain('italic')
  })

  it('handles bullet lists', async () => {
    const filePath = path.join(tmpDir, 'bullets.docx')
    const markdown = '- First item\n- Second item\n- Third item\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('First item')
    expect(result.text).toContain('Second item')
    expect(result.text).toContain('Third item')
  })

  it('handles ordered lists', async () => {
    const filePath = path.join(tmpDir, 'ordered.docx')
    const markdown = '1. First\n2. Second\n3. Third\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('First')
    expect(result.text).toContain('Third')
  })

  it('handles code blocks', async () => {
    const filePath = path.join(tmpDir, 'code.docx')
    const markdown = '```\nconst x = 42;\nconsole.log(x);\n```\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('const x = 42')
    expect(result.text).toContain('console.log')
  })

  it('handles inline code', async () => {
    const filePath = path.join(tmpDir, 'inline-code.docx')
    const markdown = 'Use `const` to declare variables.\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('const')
    expect(result.text).toContain('declare variables')
  })

  it('handles empty markdown', async () => {
    const filePath = path.join(tmpDir, 'empty.docx')

    const writeResult = await writeDocx(filePath, '')
    expect(writeResult.success).toBe(true)

    // Verify it's a valid docx
    const readResult = await readDocx(filePath)
    expect(readResult.success).toBe(true)
  })

  it('handles blockquotes', async () => {
    const filePath = path.join(tmpDir, 'blockquote.docx')
    const markdown = '> This is a quoted passage.\n'

    const writeResult = await writeDocx(filePath, markdown)
    expect(writeResult.success).toBe(true)

    // Verify it creates a valid docx file that can be read back
    const result = await readDocx(filePath) as ReadDocxResult
    expect(result.success).toBe(true)
    // Blockquote content includes the em-dash prefix from the converter
    expect(result.text).toContain('\u2014')
  })

  it('handles horizontal rules', async () => {
    const filePath = path.join(tmpDir, 'hr.docx')
    const markdown = 'Above the line.\n\n---\n\nBelow the line.\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('Above the line')
    expect(result.text).toContain('Below the line')
  })

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'output.docx')

    const writeResult = await writeDocx(filePath, '# Test\n')
    expect(writeResult.success).toBe(true)

    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
  })

  it('handles strikethrough text', async () => {
    const filePath = path.join(tmpDir, 'strike.docx')
    const markdown = 'This has ~~deleted~~ text.\n'

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('deleted')
  })

  it('handles mixed content document', async () => {
    const filePath = path.join(tmpDir, 'mixed.docx')
    const markdown = [
      '# Project Report',
      '',
      'This document covers the **Q1 results**.',
      '',
      '## Key Metrics',
      '',
      '- Revenue: $1.2M',
      '- Growth: 15%',
      '- Churn: 2.5%',
      '',
      '### Notes',
      '',
      '> Important: Review before publishing.',
      '',
      '```',
      'total = sum(values)',
      '```',
    ].join('\n')

    await writeDocx(filePath, markdown)
    const result = await readDocx(filePath) as ReadDocxResult

    expect(result.text).toContain('Project Report')
    expect(result.text).toContain('Q1 results')
    expect(result.text).toContain('Revenue')
    expect(result.text).toContain('total = sum(values)')
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Docx error handling', () => {
  it('returns read_error for non-existent file (read)', async () => {
    const result = await readDocx(path.join(tmpDir, 'missing.docx'))
    expect(result.success).toBe(false)
    expect((result as ReadError).type).toBe('read_error')
  })

  it('returns parse_error for corrupted file (read)', async () => {
    const filePath = path.join(tmpDir, 'corrupt.docx')
    await fs.writeFile(filePath, 'not a valid docx file')

    const result = await readDocx(filePath)
    expect(result.success).toBe(false)
    expect((result as ReadError).type).toBe('parse_error')
  })

  it('returns sizeBytes in successful read result', async () => {
    const filePath = path.join(tmpDir, 'size.docx')
    const buffer = await generateDocx([{ text: 'Size check' }])
    await fs.writeFile(filePath, buffer)

    const result = await readDocx(filePath) as ReadDocxResult
    expect(result.sizeBytes).toBeGreaterThan(0)
  })
})
