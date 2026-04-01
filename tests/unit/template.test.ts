/**
 * template 模块的单元测试。
 */

import { describe, expect, it } from 'vitest'

import {
  buildImportedPluginTemplate,
  inferTemplateFieldPrefix,
  isTemplateFieldActive,
  mapTemplateValuesToPluginParams,
  resolveTemplate,
  validateResolvedTemplateValues,
} from '../../src/main/core/template'
import type { ResolvedTemplate } from '../../src/main/core/contracts'

describe('template', () => {
  it('resolves plugin parameter defaults and overrides', () => {
    const template = resolveTemplate({
      id: 'node-template',
      name: 'Node.js Env',
      version: '0.1.0',
      platforms: ['darwin'],
      description: 'Node.js template',
      plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
      defaults: { 'node.nodeManager': 'nvm' },
      overrides: {
        'node.nodeManager': { editable: true, enum: ['node', 'nvm'] },
      },
      checks: [],
    })

    expect(template.fields['node.nodeManager'].value).toBe('nvm')
    expect(template.fields['node.nodeManager'].enum).toEqual(['node', 'nvm'])
  })

  it('builds executable templates for imported plugins', () => {
    const template = buildImportedPluginTemplate(
      {
        id: 'acme-env',
        name: {
          'zh-CN': 'Acme 环境',
          en: 'Acme Environment',
        },
        version: '1.2.3',
        mainAppVersion: '^0.2.4',
        platforms: ['darwin', 'win32'],
        permissions: ['download'],
        parameters: {
          installRootDir: {
            type: 'path',
            required: true,
          },
          channel: {
            type: 'enum',
            required: true,
            values: ['stable', 'beta'],
          },
        },
        dependencies: [],
        entry: 'index.mjs',
      },
      {
        dataRootDir: '/tmp/envsetup-data',
      },
    )

    expect(template.id).toBe('imported-acme-env-1.2.3')
    expect(template.plugins).toEqual([{ pluginId: 'acme-env', version: '1.2.3' }])
    expect(template.fields['acme.installRootDir'].value).toBe('/tmp/envsetup-data/toolchain/acme')
    expect(template.fields['acme.channel'].enum).toEqual(['stable', 'beta'])
    expect(template.fields['acme.channel'].editable).toBe(true)
  })

  it('rejects override for undefined field', () => {
    expect(() =>
      resolveTemplate({
        id: 'bad',
        name: 'Bad template',
        version: '0.1.0',
        platforms: ['darwin'],
        description: 'Broken template',
        plugins: [{ pluginId: 'node-env', version: '0.1.0' }],
        defaults: {},
        overrides: { 'node.missing': { editable: true } },
        checks: [],
      }),
    ).toThrowError('Undefined template field: node.missing')
  })

  it('marks non-editable fields as not editable', () => {
    const template = resolveTemplate({
      id: 't',
      name: 'T',
      version: '0.1.0',
      platforms: ['darwin'],
      description: 'T',
      plugins: [],
      defaults: { 'x.key': 'val' },
      overrides: {},
      checks: [],
    })

    expect(template.fields['x.key'].editable).toBe(false)
    expect(template.fields['x.key'].required).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// inferTemplateFieldPrefix
// ---------------------------------------------------------------------------

describe('inferTemplateFieldPrefix', () => {
  it('strips -env suffix from pluginId', () => {
    expect(inferTemplateFieldPrefix('node-env')).toBe('node')
  })

  it('returns pluginId unchanged when it does not end with -env', () => {
    expect(inferTemplateFieldPrefix('java-runtime')).toBe('java-runtime')
    expect(inferTemplateFieldPrefix('env')).toBe('env')
  })
})

// ---------------------------------------------------------------------------
// isTemplateFieldActive
// ---------------------------------------------------------------------------

describe('isTemplateFieldActive', () => {
  function makeTemplate(overrides: Partial<ResolvedTemplate> = {}): ResolvedTemplate {
    return resolveTemplate({
      id: 'tpl',
      name: 'Tpl',
      version: '0.1.0',
      platforms: ['darwin'],
      description: 'Tpl',
      plugins: [],
      defaults: {
        'x.manager': 'nvm',
        'x.extra': 'value',
      },
      overrides: {
        'x.manager': { editable: true, enum: ['nvm', 'node'] },
        'x.extra': {
          editable: true,
          dependsOn: { field: 'x.manager', equals: 'nvm' },
        },
      },
      checks: [],
      ...overrides,
    })
  }

  it('returns true for a field with no dependsOn', () => {
    const template = makeTemplate()
    expect(isTemplateFieldActive(template.fields['x.manager'], { 'x.manager': 'nvm' })).toBe(true)
  })

  it('returns true when dependsOn equals condition is satisfied', () => {
    const template = makeTemplate()
    expect(isTemplateFieldActive(template.fields['x.extra'], { 'x.manager': 'nvm' })).toBe(true)
  })

  it('returns false when dependsOn equals condition is not satisfied', () => {
    const template = makeTemplate()
    expect(isTemplateFieldActive(template.fields['x.extra'], { 'x.manager': 'node' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateResolvedTemplateValues
// ---------------------------------------------------------------------------

describe('validateResolvedTemplateValues', () => {
  function makeTpl(): ResolvedTemplate {
    return resolveTemplate({
      id: 'tpl',
      name: 'Tpl',
      version: '0.1.0',
      platforms: ['darwin'],
      description: 'Tpl',
      plugins: [],
      defaults: {
        'x.name': '',
        'x.count': 5,
        'x.mode': 'fast',
        'x.tag': 'abc',
      },
      overrides: {
        'x.name': { editable: true, required: true },
        'x.count': { editable: true, range: { min: 1, max: 10 } },
        'x.mode': { editable: true, enum: ['fast', 'slow'] },
        'x.tag': { editable: true, pattern: '^[a-z]+$' },
      },
      checks: [],
    })
  }

  it('returns no errors for valid values', () => {
    const errors = validateResolvedTemplateValues(makeTpl(), {
      'x.name': 'myapp',
      'x.count': 3,
      'x.mode': 'fast',
      'x.tag': 'abc',
    })
    expect(errors).toEqual({})
  })

  it('reports required field when empty string', () => {
    const errors = validateResolvedTemplateValues(makeTpl(), {
      'x.name': '',
      'x.count': 5,
      'x.mode': 'fast',
      'x.tag': 'abc',
    })
    expect(errors['x.name']).toBeDefined()
  })

  it('reports required field when null', () => {
    const errors = validateResolvedTemplateValues(makeTpl(), {
      'x.name': null,
      'x.count': 5,
      'x.mode': 'fast',
      'x.tag': 'abc',
    })
    expect(errors['x.name']).toBeDefined()
  })

  it('reports out-of-range number', () => {
    const errors = validateResolvedTemplateValues(makeTpl(), {
      'x.name': 'ok',
      'x.count': 20,
      'x.mode': 'fast',
      'x.tag': 'abc',
    })
    expect(errors['x.count']).toBeDefined()
  })

  it('reports invalid enum value', () => {
    const errors = validateResolvedTemplateValues(makeTpl(), {
      'x.name': 'ok',
      'x.count': 5,
      'x.mode': 'turbo',
      'x.tag': 'abc',
    })
    expect(errors['x.mode']).toBeDefined()
  })

  it('reports pattern mismatch', () => {
    const errors = validateResolvedTemplateValues(makeTpl(), {
      'x.name': 'ok',
      'x.count': 5,
      'x.mode': 'fast',
      'x.tag': 'ABC123',
    })
    expect(errors['x.tag']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// mapTemplateValuesToPluginParams
// ---------------------------------------------------------------------------

describe('mapTemplateValuesToPluginParams', () => {
  it('strips the plugin prefix from keys', () => {
    const params = mapTemplateValuesToPluginParams('node-env', {
      'node.nodeVersion': '20.11.1',
      'node.installRootDir': '/tools',
      'other.key': 'ignored',
    })

    expect(params['nodeVersion']).toBe('20.11.1')
    expect(params['installRootDir']).toBe('/tools')
    expect('other.key' in params).toBe(false)
    expect('key' in params).toBe(false)
  })

  it('returns empty object when no keys match the prefix', () => {
    const params = mapTemplateValuesToPluginParams('node-env', {
      'java.home': '/usr/lib/jvm',
    })
    expect(params).toEqual({})
  })
})
