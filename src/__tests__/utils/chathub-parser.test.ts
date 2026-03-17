import { describe, it, expect } from 'vitest'
import {
  appendChunkToParsedMessageItems,
  parseMessage,
  collectChatArtifacts,
} from '@/utils/chathub-parser'
import type { ChatMessageContentChunk } from '@/types/chathub'

describe('chathub-parser', () => {
  describe('appendChunkToParsedMessageItems', () => {
    it('parses plain text into a text chunk', () => {
      const result = appendChunkToParsedMessageItems([], 'Hello world')
      expect(result).toEqual([{ type: 'text', content: 'Hello world' }])
    })

    it('merges consecutive text chunks', () => {
      let items: ChatMessageContentChunk[] = []
      items = appendChunkToParsedMessageItems(items, 'Hello ')
      items = appendChunkToParsedMessageItems(items, 'world')
      expect(items).toEqual([{ type: 'text', content: 'Hello world' }])
    })

    it('parses a complete artifact-create command', () => {
      const cmd = '<command:artifact-create><title>Test</title><type>code</type><content>console.log("hi")</content></command:artifact-create>'
      const result = appendChunkToParsedMessageItems([], cmd)

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('artifact-create')
      if (result[0].type === 'artifact-create') {
        expect(result[0].command.title).toBe('Test')
        expect(result[0].command.type).toBe('code')
        expect(result[0].command.content).toBe('console.log("hi")')
        expect(result[0].isIncomplete).toBe(false)
      }
    })

    it('handles incomplete artifact-create across chunks', () => {
      let items: ChatMessageContentChunk[] = []
      items = appendChunkToParsedMessageItems(items, '<command:artifact-create><title>T')

      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('artifact-create')
      if (items[0].type === 'artifact-create') {
        expect(items[0].isIncomplete).toBe(true)
      }

      items = appendChunkToParsedMessageItems(items, 'est</title><type>code</type><content>x</content></command:artifact-create>')

      expect(items).toHaveLength(1)
      if (items[0].type === 'artifact-create') {
        expect(items[0].isIncomplete).toBe(false)
        expect(items[0].command.title).toBe('Test')
      }
    })

    it('parses artifact-edit command', () => {
      const cmd = '<command:artifact-edit><title>Doc</title><oldString>foo</oldString><newString>bar</newString><replaceAll>true</replaceAll></command:artifact-edit>'
      const result = appendChunkToParsedMessageItems([], cmd)

      expect(result).toHaveLength(1)
      if (result[0].type === 'artifact-edit') {
        expect(result[0].command.title).toBe('Doc')
        expect(result[0].command.oldString).toBe('foo')
        expect(result[0].command.newString).toBe('bar')
        expect(result[0].command.replaceAll).toBe(true)
      }
    })

    it('buffers potential command prefix as hidden', () => {
      const items = appendChunkToParsedMessageItems([], 'Hello <command:art')
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ type: 'text', content: 'Hello ' })
      expect(items[1]).toEqual({ type: 'hidden', content: '<command:art' })
    })

    it('resolves hidden prefix when next chunk completes it', () => {
      let items: ChatMessageContentChunk[] = []
      items = appendChunkToParsedMessageItems(items, 'text <')
      // '<' is a potential command prefix
      expect(items.some((i) => i.type === 'hidden')).toBe(true)

      items = appendChunkToParsedMessageItems(items, 'not a command')
      // Now '<not a command' is just text
      expect(items.every((i) => i.type === 'text')).toBe(true)
    })

    it('handles text before and after a command', () => {
      const input = 'before <command:artifact-create><title>T</title><type>t</type><content>c</content></command:artifact-create> after'
      const result = appendChunkToParsedMessageItems([], input)

      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0]).toEqual({ type: 'text', content: 'before ' })
      expect(result.find((i) => i.type === 'artifact-create')).toBeTruthy()
    })

    it('parses buttons JSON payload', () => {
      const json = JSON.stringify({
        text: 'Choose an option',
        buttons: [
          { text: 'Yes', link: '/yes', type: 'primary' },
          { text: 'No', link: '/no', type: 'secondary' },
        ],
        blockUserInput: true,
      })

      const result = appendChunkToParsedMessageItems([], json)
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('with-buttons')
      if (result[0].type === 'with-buttons') {
        expect(result[0].content).toBe('Choose an option')
        expect(result[0].buttons).toHaveLength(2)
        expect(result[0].blockUserInput).toBe(true)
      }
    })

    it('does not parse invalid buttons JSON', () => {
      const json = JSON.stringify({ text: 'hi', buttons: 'not-array', blockUserInput: true })
      const result = appendChunkToParsedMessageItems([], json)
      // Should fall through to text parsing
      expect(result[0].type).toBe('text')
    })

    it('handles empty chunk', () => {
      const result = appendChunkToParsedMessageItems([], '')
      expect(result).toEqual([])
    })
  })

  describe('parseMessage', () => {
    it('returns plain text for non-ai messages', () => {
      const result = parseMessage({ type: 'human', content: 'Hello <command:artifact-create>' })
      expect(result).toEqual([{ type: 'text', content: 'Hello <command:artifact-create>' }])
    })

    it('parses commands for ai messages', () => {
      const cmd = '<command:artifact-create><title>X</title><type>t</type><content>c</content></command:artifact-create>'
      const result = parseMessage({ type: 'ai', content: cmd })
      expect(result[0].type).toBe('artifact-create')
    })
  })

  describe('collectChatArtifacts', () => {
    it('collects create commands into artifacts', () => {
      const items: ChatMessageContentChunk[] = [
        {
          type: 'artifact-create',
          content: '',
          command: { title: 'Doc', type: 'markdown', content: '# Hello' },
          isIncomplete: false,
        },
      ]

      const artifacts = collectChatArtifacts(items)
      expect(artifacts).toEqual([
        { title: 'Doc', type: 'markdown', content: '# Hello' },
      ])
    })

    it('applies edit commands to existing artifacts', () => {
      const items: ChatMessageContentChunk[] = [
        {
          type: 'artifact-create',
          content: '',
          command: { title: 'Doc', type: 'text', content: 'Hello world' },
          isIncomplete: false,
        },
        {
          type: 'artifact-edit',
          content: '',
          command: { title: 'Doc', oldString: 'world', newString: 'there', replaceAll: false },
          isIncomplete: false,
        },
      ]

      const artifacts = collectChatArtifacts(items)
      expect(artifacts[0].content).toBe('Hello there')
    })

    it('applies replaceAll edits', () => {
      const items: ChatMessageContentChunk[] = [
        {
          type: 'artifact-create',
          content: '',
          command: { title: 'Doc', type: 'text', content: 'aaa bbb aaa' },
          isIncomplete: false,
        },
        {
          type: 'artifact-edit',
          content: '',
          command: { title: 'Doc', oldString: 'aaa', newString: 'ccc', replaceAll: true },
          isIncomplete: false,
        },
      ]

      const artifacts = collectChatArtifacts(items)
      expect(artifacts[0].content).toBe('ccc bbb ccc')
    })

    it('skips create commands with empty title', () => {
      const items: ChatMessageContentChunk[] = [
        {
          type: 'artifact-create',
          content: '',
          command: { title: '', type: 'text', content: 'no title' },
          isIncomplete: false,
        },
      ]

      expect(collectChatArtifacts(items)).toEqual([])
    })

    it('ignores edit for non-existent artifact', () => {
      const items: ChatMessageContentChunk[] = [
        {
          type: 'artifact-edit',
          content: '',
          command: { title: 'Missing', oldString: 'a', newString: 'b', replaceAll: false },
          isIncomplete: false,
        },
      ]

      expect(collectChatArtifacts(items)).toEqual([])
    })

    it('ignores text chunks', () => {
      const items: ChatMessageContentChunk[] = [
        { type: 'text', content: 'just text' },
      ]

      expect(collectChatArtifacts(items)).toEqual([])
    })
  })
})
