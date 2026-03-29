/**
 * Loads built-in templates and resolves them into executable installation plans.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  Primitive,
  ResolvedTemplate,
  ResolvedTemplateField,
  TemplateManifest,
} from './contracts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function inferTemplateFieldPrefix(pluginId: string): string {
  return pluginId.endsWith('-env') ? pluginId.slice(0, -4) : pluginId
}

export function resolveTemplate(template: TemplateManifest): ResolvedTemplate {
  const normalizedFields = Object.entries(template.defaults).reduce<
    Record<string, ResolvedTemplateField>
  >((fields, [key, value]) => {
    const override = template.overrides[key]
    fields[key] = {
      key,
      value,
      type: override?.type,
      editable: override?.editable ?? false,
      required: override?.required ?? false,
      enum: override?.enum,
      range: override?.range,
      pattern: override?.pattern,
      affects: override?.affects,
      dependsOn: override?.dependsOn,
    }
    return fields
  }, {})

  for (const key of Object.keys(template.overrides)) {
    if (!(key in template.defaults)) {
      throw new Error(`Undefined template field: ${key}`)
    }
  }

  return {
    ...template,
    fields: normalizedFields,
  }
}

export async function loadTemplate(filePath: string): Promise<ResolvedTemplate> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  if (!isObject(raw)) {
    throw new Error(`Invalid template manifest: ${filePath}`)
  }

  return resolveTemplate(raw as TemplateManifest)
}

export async function loadTemplatesFromDirectory(dir: string): Promise<ResolvedTemplate[]> {
  const files = (await readdir(dir)).filter((entry) => entry.endsWith('.json')).sort()

  return Promise.all(files.map((file) => loadTemplate(join(dir, file))))
}

export function isTemplateFieldActive(
  field: ResolvedTemplateField,
  values: Record<string, Primitive>,
): boolean {
  if (!field.dependsOn) {
    return true
  }

  const dependencyValue = values[field.dependsOn.field]
  if (field.dependsOn.in) {
    return field.dependsOn.in.includes(dependencyValue)
  }

  if (Object.prototype.hasOwnProperty.call(field.dependsOn, 'equals')) {
    return dependencyValue === field.dependsOn.equals
  }

  return true
}

export function validateResolvedTemplateValues(
  template: ResolvedTemplate,
  values: Record<string, Primitive>,
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of Object.values(template.fields)) {
    if (!isTemplateFieldActive(field, values)) {
      continue
    }

    const value = values[field.key]

    if (field.required && (value === '' || value === null || value === undefined)) {
      errors[field.key] = 'This value is required.'
      continue
    }

    if (value === null || value === undefined || value === '') {
      continue
    }

    if (field.enum && typeof value === 'string' && !field.enum.includes(value)) {
      errors[field.key] = 'Select a supported option.'
      continue
    }

    if (field.range && typeof value === 'number') {
      const { min, max } = field.range
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        errors[field.key] = 'Value is outside the allowed range.'
        continue
      }
    }

    if (field.pattern && typeof value === 'string') {
      const pattern = new RegExp(field.pattern)
      if (!pattern.test(value)) {
        errors[field.key] = 'Value does not match the expected pattern.'
      }
    }
  }

  return errors
}

export function mapTemplateValuesToPluginParams(
  pluginId: string,
  values: Record<string, Primitive>,
): Record<string, Primitive> {
  const prefix = `${inferTemplateFieldPrefix(pluginId)}.`

  return Object.entries(values).reduce<Record<string, Primitive>>((params, [key, value]) => {
    if (key.startsWith(prefix)) {
      params[key.slice(prefix.length)] = value
    }
    return params
  }, {})
}
