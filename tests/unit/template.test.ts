import { describe, expect, it } from 'vitest'

import { resolveTemplate } from '../../src/main/core/template'

describe('template', () => {
  it('resolves plugin parameter defaults and overrides', () => {
    const template = resolveTemplate({
      id: 'frontend-template',
      name: 'Frontend Env',
      version: '0.1.0',
      platforms: ['darwin'],
      description: 'Frontend template',
      plugins: [{ pluginId: 'frontend-env', version: '0.1.0' }],
      defaults: { 'frontend.nodeManager': 'nvm' },
      overrides: {
        'frontend.nodeManager': { editable: true, enum: ['node', 'nvm'] },
      },
      checks: [],
    })

    expect(template.fields['frontend.nodeManager'].value).toBe('nvm')
    expect(template.fields['frontend.nodeManager'].enum).toEqual(['node', 'nvm'])
  })

  it('rejects override for undefined field', () => {
    expect(() =>
      resolveTemplate({
        id: 'bad',
        name: 'Bad template',
        version: '0.1.0',
        platforms: ['darwin'],
        description: 'Broken template',
        plugins: [{ pluginId: 'frontend-env', version: '0.1.0' }],
        defaults: {},
        overrides: { 'frontend.missing': { editable: true } },
        checks: [],
      }),
    ).toThrowError('Undefined template field: frontend.missing')
  })
})
