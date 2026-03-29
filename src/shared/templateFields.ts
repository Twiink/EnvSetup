/**
 * Validates template field definitions and resolved values shared across the application.
 */

import type { Primitive, ResolvedTemplate, ResolvedTemplateField } from '../main/core/contracts'
import type { AppLocale } from './locale'
import { DEFAULT_LOCALE } from './locale'

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
  locale: AppLocale = DEFAULT_LOCALE,
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of Object.values(template.fields)) {
    if (!isTemplateFieldActive(field, values)) {
      continue
    }

    const value = values[field.key]

    if (field.required && (value === '' || value === null || value === undefined)) {
      errors[field.key] = locale === 'zh-CN' ? '该字段为必填项。' : 'This value is required.'
      continue
    }

    if (value === null || value === undefined || value === '') {
      continue
    }

    if (field.enum && typeof value === 'string' && !field.enum.includes(value)) {
      errors[field.key] = locale === 'zh-CN' ? '请选择受支持的选项。' : 'Select a supported option.'
      continue
    }

    if (field.range && typeof value === 'number') {
      const { min, max } = field.range
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        errors[field.key] =
          locale === 'zh-CN' ? '输入值超出了允许范围。' : 'Value is outside the allowed range.'
        continue
      }
    }

    if (field.pattern && typeof value === 'string') {
      const pattern = new RegExp(field.pattern)
      if (!pattern.test(value)) {
        errors[field.key] =
          locale === 'zh-CN'
            ? '输入值不符合预期格式。'
            : 'Value does not match the expected pattern.'
      }
    }
  }

  return errors
}
