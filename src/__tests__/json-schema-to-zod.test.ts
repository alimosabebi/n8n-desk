import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// Mock @langchain/core/tools — imported by tool-definitions at top level
vi.mock('@langchain/core/tools', () => ({
  tool: vi.fn(),
}))

// Mock mcp-client — imported by tool-definitions at top level
vi.mock('../../electron/mcp-client', () => ({
  callTool: vi.fn(),
  callToolWithUrl: vi.fn(),
  listToolsWithUrl: vi.fn(),
}))

// Now import the function under test
import { jsonSchemaToZod } from '../../electron/agent/tool-definitions'

describe('jsonSchemaToZod', () => {
  describe('primitive types', () => {
    it('converts string type', () => {
      const schema = jsonSchemaToZod({ type: 'string' })
      expect(schema).toBeInstanceOf(z.ZodString)
      // Validate a string value passes
      expect(schema.parse('hello')).toBe('hello')
    })

    it('converts number type', () => {
      const schema = jsonSchemaToZod({ type: 'number' })
      expect(schema).toBeInstanceOf(z.ZodNumber)
      expect(schema.parse(42)).toBe(42)
    })

    it('converts integer type to ZodNumber', () => {
      const schema = jsonSchemaToZod({ type: 'integer' })
      expect(schema).toBeInstanceOf(z.ZodNumber)
      expect(schema.parse(7)).toBe(7)
    })

    it('converts boolean type', () => {
      const schema = jsonSchemaToZod({ type: 'boolean' })
      expect(schema).toBeInstanceOf(z.ZodBoolean)
      expect(schema.parse(true)).toBe(true)
    })
  })

  describe('enum type', () => {
    it('converts enum values', () => {
      const schema = jsonSchemaToZod({ enum: ['red', 'green', 'blue'] })
      expect(schema).toBeInstanceOf(z.ZodEnum)
      expect(schema.parse('red')).toBe('red')
    })

    it('rejects values not in enum', () => {
      const schema = jsonSchemaToZod({ enum: ['a', 'b'] })
      expect(() => schema.parse('c')).toThrow()
    })

    it('enum takes precedence over type', () => {
      const schema = jsonSchemaToZod({ type: 'string', enum: ['x', 'y'] })
      expect(schema).toBeInstanceOf(z.ZodEnum)
      expect(() => schema.parse('z')).toThrow()
    })
  })

  describe('array type', () => {
    it('converts array with typed items', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: { type: 'string' },
      })
      expect(schema).toBeInstanceOf(z.ZodArray)
      expect(schema.parse(['a', 'b'])).toEqual(['a', 'b'])
    })

    it('converts array without items to z.array(z.any())', () => {
      const schema = jsonSchemaToZod({ type: 'array' })
      expect(schema).toBeInstanceOf(z.ZodArray)
      // Should accept any item types
      expect(schema.parse([1, 'two', true])).toEqual([1, 'two', true])
    })

    it('converts array with nested object items', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
          },
          required: ['id'],
        },
      })
      expect(schema.parse([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }])
    })
  })

  describe('object type', () => {
    it('converts object with properties', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      })
      // Required property
      expect(schema.parse({ name: 'Alice' })).toEqual({ name: 'Alice' })
      // With optional
      expect(schema.parse({ name: 'Bob', age: 30 })).toEqual({ name: 'Bob', age: 30 })
    })

    it('marks non-required properties as optional', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          required_field: { type: 'string' },
          optional_field: { type: 'number' },
        },
        required: ['required_field'],
      })
      // Should pass without optional_field
      const result = schema.parse({ required_field: 'test' })
      expect(result).toEqual({ required_field: 'test' })
    })

    it('converts object without properties to z.record(z.any())', () => {
      const schema = jsonSchemaToZod({ type: 'object' })
      expect(schema).toBeInstanceOf(z.ZodRecord)
      expect(schema.parse({ anything: 'goes' })).toEqual({ anything: 'goes' })
    })

    it('preserves description on properties', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The user name' },
        },
        required: ['name'],
      })
      // ZodObject shape should have a description on the name field
      const nameField = (schema as z.ZodObject<z.ZodRawShape>).shape.name
      expect(nameField.description).toBe('The user name')
    })

    it('handles nested objects', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              zip: { type: 'string' },
            },
            required: ['city'],
          },
        },
        required: ['address'],
      })
      expect(schema.parse({ address: { city: 'NYC' } })).toEqual({
        address: { city: 'NYC' },
      })
    })

    it('marks all properties optional when required array is absent', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
      })
      // Both should be optional — empty object should pass
      expect(schema.parse({})).toEqual({})
    })
  })

  describe('fallback / unknown types', () => {
    it('falls back to z.any() for unknown type', () => {
      const schema = jsonSchemaToZod({ type: 'null' })
      expect(schema).toBeInstanceOf(z.ZodAny)
    })

    it('falls back to z.any() for missing type', () => {
      const schema = jsonSchemaToZod({})
      expect(schema).toBeInstanceOf(z.ZodAny)
    })

    it('falls back to z.any() for complex constructs like allOf', () => {
      const schema = jsonSchemaToZod({
        allOf: [{ type: 'string' }, { minLength: 1 }],
      })
      expect(schema).toBeInstanceOf(z.ZodAny)
    })
  })
})
