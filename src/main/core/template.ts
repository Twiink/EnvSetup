/**
 * 加载内置模板并解析成可执行的安装计划。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  EnvironmentTool,
  PluginManifest,
  Primitive,
  ResolvedTemplate,
  ResolvedTemplateField,
  TemplateManifest,
} from './contracts'
import { resolveLocalizedText } from '../../shared/locale'
export {
  isTemplateFieldActive,
  validateResolvedTemplateValues,
} from '../../shared/templateFields'

const BUILTIN_ENVIRONMENT_TOOLS = new Set<EnvironmentTool>([
  'node',
  'java',
  'python',
  'git',
  'mysql',
  'redis',
  'maven',
])

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

function toTemplateFieldKey(pluginId: string, paramKey: string): string {
  return `${inferTemplateFieldPrefix(pluginId)}.${paramKey}`
}

function slugifyPathFragment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default'
}

function buildPathDefault(baseDir: string, pluginId: string, paramKey: string): string {
  if (paramKey === 'installRootDir') {
    return join(baseDir, 'toolchain', inferTemplateFieldPrefix(pluginId))
  }

  return join(baseDir, slugifyPathFragment(`${pluginId}-${paramKey}`))
}

function resolveParameterDefault(
  pluginId: string,
  paramKey: string,
  fieldType: PluginManifest['parameters'][string]['type'],
  baseDir: string,
  values?: string[],
): Primitive {
  if (fieldType === 'boolean') {
    return false
  }

  if (fieldType === 'number') {
    return 0
  }

  if (fieldType === 'path') {
    return buildPathDefault(baseDir, pluginId, paramKey)
  }

  return values?.[0] ?? ''
}

export function buildImportedPluginTemplate(
  manifest: PluginManifest,
  options: { dataRootDir: string },
): ResolvedTemplate {
  const pluginDisplayName = resolveLocalizedText(manifest.name, 'en', manifest.id)
  const defaults: Record<string, Primitive> = {}
  const overrides: TemplateManifest['overrides'] = {}

  for (const [paramKey, definition] of Object.entries(manifest.parameters)) {
    const fieldKey = toTemplateFieldKey(manifest.id, paramKey)
    defaults[fieldKey] = resolveParameterDefault(
      manifest.id,
      paramKey,
      definition.type,
      options.dataRootDir,
      definition.values,
    )
    overrides[fieldKey] = {
      type: definition.type,
      editable: true,
      required: definition.required ?? false,
      enum: definition.values,
      affects: [manifest.id],
    }
  }

  const inferredTool = inferTemplateFieldPrefix(manifest.id) as EnvironmentTool
  const checks = BUILTIN_ENVIRONMENT_TOOLS.has(inferredTool) ? [inferredTool] : []

  return resolveTemplate({
    id: `imported-${manifest.id}-${manifest.version}`,
    name: manifest.name,
    version: manifest.version,
    platforms: manifest.platforms,
    description: {
      'zh-CN': `导入插件 ${resolveLocalizedText(manifest.name, 'zh-CN', pluginDisplayName)} 的执行模板，导入后可直接参与预检、任务执行与回滚链路。`,
      en: `Execution template for the imported plugin ${pluginDisplayName}. It participates in precheck, task execution, and rollback immediately after import.`,
    },
    plugins: [{ pluginId: manifest.id, version: manifest.version }],
    defaults,
    overrides,
    checks,
    recommended: false,
  })
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
