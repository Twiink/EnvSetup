/**
 * templateFields 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import {
  isTemplateFieldActive,
  validateResolvedTemplateValues,
} from '../../src/shared/templateFields'
import type { ResolvedTemplate, ResolvedTemplateField } from '../../src/main/core/contracts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<ResolvedTemplateField> = {}): ResolvedTemplateField {
  return {
    key: 'x.field',
    type: 'string',
    value: '',
    editable: true,
    required: false,
    ...overrides,
  }
}

function makeTemplate(fields: Record<string, ResolvedTemplateField>): ResolvedTemplate {
  return {
    id: 'tpl',
    name: 'Tpl',
    version: '0.1.0',
    platforms: ['darwin'],
    description: 'Tpl',
    plugins: [],
    defaults: {},
    overrides: {},
    checks: [],
    fields,
  }
}

// ---------------------------------------------------------------------------
// isTemplateFieldActive — dependsOn.in branch
// ---------------------------------------------------------------------------

describe('isTemplateFieldActive', () => {
  it('returns true when no dependsOn is set', () => {
    const field = makeField()
    expect(isTemplateFieldActive(field, {})).toBe(true)
  })

  it('returns true when dependsOn.equals matches', () => {
    const field = makeField({ dependsOn: { field: 'x.mode', equals: 'nvm' } })
    expect(isTemplateFieldActive(field, { 'x.mode': 'nvm' })).toBe(true)
  })

  it('returns false when dependsOn.equals does not match', () => {
    const field = makeField({ dependsOn: { field: 'x.mode', equals: 'nvm' } })
    expect(isTemplateFieldActive(field, { 'x.mode': 'node' })).toBe(false)
  })

  it('returns true when dependsOn.in includes the value', () => {
    const field = makeField({ dependsOn: { field: 'x.mode', in: ['nvm', 'fnm'] } })
    expect(isTemplateFieldActive(field, { 'x.mode': 'nvm' })).toBe(true)
    expect(isTemplateFieldActive(field, { 'x.mode': 'fnm' })).toBe(true)
  })

  it('returns false when dependsOn.in does not include the value', () => {
    const field = makeField({ dependsOn: { field: 'x.mode', in: ['nvm', 'fnm'] } })
    expect(isTemplateFieldActive(field, { 'x.mode': 'node' })).toBe(false)
  })

  it('dependsOn.in takes precedence over equals when both are present', () => {
    const field = makeField({
      dependsOn: { field: 'x.mode', in: ['nvm'], equals: 'node' },
    })
    // in includes 'nvm' → true, even though equals would want 'node'
    expect(isTemplateFieldActive(field, { 'x.mode': 'nvm' })).toBe(true)
    // in does not include 'node' → false, even though equals matches
    expect(isTemplateFieldActive(field, { 'x.mode': 'node' })).toBe(false)
  })

  it('returns true when dependsOn has neither in nor equals', () => {
    const field = makeField({ dependsOn: { field: 'x.mode' } })
    expect(isTemplateFieldActive(field, { 'x.mode': 'anything' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateResolvedTemplateValues — edge cases
// ---------------------------------------------------------------------------

describe('validateResolvedTemplateValues', () => {
  it('skips inactive fields', () => {
    const template = makeTemplate({
      'x.mode': makeField({ key: 'x.mode', value: 'nvm', required: true }),
      'x.extra': makeField({
        key: 'x.extra',
        required: true,
        dependsOn: { field: 'x.mode', equals: 'nvm' },
      }),
    })

    // x.extra is inactive because x.mode !== 'nvm'
    const errors = validateResolvedTemplateValues(template, {
      'x.mode': 'node',
      'x.extra': '',
    })
    expect(errors).toEqual({})
  })

  it('reports required field when value is undefined', () => {
    const template = makeTemplate({
      'x.name': makeField({ key: 'x.name', required: true }),
    })
    const errors = validateResolvedTemplateValues(template, {})
    expect(errors['x.name']).toBeDefined()
  })

  it('skips optional empty fields without error', () => {
    const template = makeTemplate({
      'x.opt': makeField({ key: 'x.opt', required: false }),
    })
    const errors = validateResolvedTemplateValues(template, { 'x.opt': '' })
    expect(errors).toEqual({})
  })

  it('validates range min boundary', () => {
    const template = makeTemplate({
      'x.count': makeField({
        key: 'x.count',
        type: 'number',
        value: 5,
        range: { min: 1, max: 10 },
      }),
    })
    const errors = validateResolvedTemplateValues(template, { 'x.count': 0 })
    expect(errors['x.count']).toBeDefined()
  })

  it('validates range max boundary', () => {
    const template = makeTemplate({
      'x.count': makeField({
        key: 'x.count',
        type: 'number',
        value: 5,
        range: { min: 1, max: 10 },
      }),
    })
    const errors = validateResolvedTemplateValues(template, { 'x.count': 11 })
    expect(errors['x.count']).toBeDefined()
  })

  it('passes when value is exactly at range boundary', () => {
    const template = makeTemplate({
      'x.count': makeField({
        key: 'x.count',
        type: 'number',
        value: 5,
        range: { min: 1, max: 10 },
      }),
    })
    expect(validateResolvedTemplateValues(template, { 'x.count': 1 })).toEqual({})
    expect(validateResolvedTemplateValues(template, { 'x.count': 10 })).toEqual({})
  })

  it('validates enum values', () => {
    const template = makeTemplate({
      'x.mode': makeField({ key: 'x.mode', value: 'fast', enum: ['fast', 'slow'] }),
    })
    const errors = validateResolvedTemplateValues(template, { 'x.mode': 'turbo' })
    expect(errors['x.mode']).toBeDefined()
  })

  it('validates pattern', () => {
    const template = makeTemplate({
      'x.tag': makeField({ key: 'x.tag', value: 'abc', pattern: '^[a-z]+$' }),
    })
    expect(validateResolvedTemplateValues(template, { 'x.tag': 'abc' })).toEqual({})
    expect(validateResolvedTemplateValues(template, { 'x.tag': 'ABC' })).toHaveProperty('x.tag')
  })

  it('uses en locale for error messages', () => {
    const template = makeTemplate({
      'x.name': makeField({ key: 'x.name', required: true }),
    })
    const errors = validateResolvedTemplateValues(template, { 'x.name': '' }, 'en')
    expect(errors['x.name']).toContain('required')
  })
})
