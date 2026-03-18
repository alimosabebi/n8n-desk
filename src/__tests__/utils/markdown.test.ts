import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/utils/markdown'

describe('renderMarkdown', () => {
  describe('basic markdown → HTML', () => {
    it('renders paragraphs', () => {
      const result = renderMarkdown('Hello world')
      expect(result).toContain('<p>Hello world</p>')
    })

    it('renders bold and italic', () => {
      const result = renderMarkdown('**bold** and *italic*')
      expect(result).toContain('<strong>bold</strong>')
      expect(result).toContain('<em>italic</em>')
    })

    it('renders unordered lists', () => {
      const result = renderMarkdown('- item 1\n- item 2')
      expect(result).toContain('<li>item 1</li>')
      expect(result).toContain('<li>item 2</li>')
    })

    it('renders headings', () => {
      const result = renderMarkdown('# Title')
      expect(result).toContain('<h1>Title</h1>')
    })

    it('converts line breaks (breaks: true)', () => {
      const result = renderMarkdown('line one\nline two')
      expect(result).toContain('<br>')
    })
  })

  describe('code highlighting', () => {
    it('highlights known languages', () => {
      const result = renderMarkdown('```javascript\nconst x = 1;\n```')
      expect(result).toContain('class="hljs"')
      expect(result).toContain('<code>')
    })

    it('highlights typescript via ts alias', () => {
      const result = renderMarkdown('```ts\nconst x: number = 1;\n```')
      expect(result).toContain('class="hljs"')
    })

    it('escapes unknown languages', () => {
      const result = renderMarkdown('```unknownlang\n<div>test</div>\n```')
      expect(result).toContain('class="hljs"')
      expect(result).toContain('&lt;div&gt;')
      expect(result).not.toContain('<div>test</div>')
    })

    it('renders inline code', () => {
      const result = renderMarkdown('Use `console.log()`')
      expect(result).toContain('<code>console.log()</code>')
    })
  })

  describe('link safety', () => {
    it('adds target="_blank" and rel="noopener noreferrer" to links', () => {
      const result = renderMarkdown('[click](https://example.com)')
      expect(result).toContain('target="_blank"')
      expect(result).toContain('rel="noopener noreferrer"')
      expect(result).toContain('href="https://example.com"')
    })

    it('auto-linkifies URLs (linkify: true)', () => {
      const result = renderMarkdown('Visit https://example.com today')
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('target="_blank"')
    })
  })

  describe('XSS prevention', () => {
    it('does not render raw HTML tags (html: false)', () => {
      const result = renderMarkdown('<script>alert("xss")</script>')
      expect(result).not.toContain('<script>')
    })

    it('escapes HTML in code blocks', () => {
      const result = renderMarkdown('```\n<img src=x onerror=alert(1)>\n```')
      expect(result).toContain('&lt;img')
      // The tag is escaped so it won't execute — no raw <img> element
      expect(result).not.toContain('<img ')
    })

    it('does not render img tags from markdown', () => {
      const result = renderMarkdown('<img src="x" onerror="alert(1)">')
      expect(result).not.toContain('<img')
    })

    it('handles javascript: protocol in links', () => {
      // markdown-it with html:false escapes the raw <a> tag entirely
      const result = renderMarkdown('<a href="javascript:alert(1)">click</a>')
      // No actual clickable <a> element is rendered
      expect(result).not.toContain('<a ')
      expect(result).toContain('&lt;a')
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = renderMarkdown('')
      expect(result).toBe('')
    })

    it('handles string with only whitespace', () => {
      const result = renderMarkdown('   ')
      expect(result).toBeDefined()
    })
  })
})
