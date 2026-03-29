/**
 * Summarizes task failures into actionable diagnostics for the renderer and tests.
 */

import type { ErrorCode, FailureAnalysis, FailureCategory, PluginInstallResult } from './contracts'

function categoryFromErrorCode(errorCode?: ErrorCode): FailureCategory | undefined {
  switch (errorCode) {
    case 'DOWNLOAD_CHECKSUM_FAILED':
    case 'DOWNLOAD_HOST_UNTRUSTED':
      return 'conflict'
    case 'DOWNLOAD_FAILED':
    case 'DOWNLOAD_RETRY_EXHAUSTED':
    case 'NETWORK_UNAVAILABLE':
      return 'network'
    case 'PERMISSION_DENIED':
    case 'ELEVATION_REQUIRED':
      return 'permission'
    case 'PLUGIN_DEPENDENCY_MISSING':
      return 'dependency'
    case 'PATH_NOT_WRITABLE':
    case 'EXISTING_ENV_DETECTED':
    case 'VERSION_INCOMPATIBLE':
    case 'ARCH_UNSUPPORTED':
    case 'ENV_PERSISTENCE_FAILED':
      return 'conflict'
    default:
      return undefined
  }
}

export function categorizeError(errorMessage: string): FailureCategory {
  const msg = errorMessage.toLowerCase()

  if (
    msg.includes('eacces') ||
    msg.includes('eperm') ||
    msg.includes('permission denied') ||
    msg.includes('sudo')
  ) {
    return 'permission'
  }

  if (msg.includes('already exists') || msg.includes('eexist') || msg.includes('conflict')) {
    return 'conflict'
  }

  // dependency 优先：明确的依赖缺失上下文（在 network 检测之前）
  if (
    msg.includes('command not found') ||
    msg.includes('enoent') ||
    msg.includes('missing') ||
    msg.includes('not found:')
  ) {
    return 'dependency'
  }

  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('fetch') ||
    msg.includes('download') ||
    msg.includes('network') ||
    msg.includes('curl') ||
    msg.includes('wget')
  ) {
    return 'network'
  }

  // 宽泛的 'not found'（无冒号，可能是 network 上下文中的 not found）
  if (msg.includes('not found')) {
    return 'dependency'
  }

  return 'unknown'
}

/**
 * 判断失败是否可重试
 */
export function isRetryable(category: FailureCategory): boolean {
  return category === 'network' || category === 'unknown'
}

/**
 * 生成建议操作
 */
export function suggestAction(category: FailureCategory, _detail?: string): string {
  switch (category) {
    case 'network':
      return 'Check network connection and retry'
    case 'permission':
      return 'Run with elevated privileges or fix file permissions'
    case 'conflict':
      return 'Remove conflicting files or use --force flag'
    case 'dependency':
      return 'Install missing dependencies first'
    case 'unknown':
      return 'Check logs for details and retry'
  }
}

/**
 * 分析插件安装失败原因
 * 基于错误信息、错误码等判断失败类别
 */
export function analyzeFailure(result: PluginInstallResult): FailureAnalysis {
  if (result.status !== 'failed') {
    return {
      category: 'unknown',
      message: 'Plugin did not fail; no failure to analyze',
      retryable: false,
    }
  }

  // 优先使用 result.error，其次检查 logs 末尾几行
  const errorText = result.error ?? result.logs.slice(-5).join('\n')

  if (!errorText) {
    return {
      category: 'unknown',
      message: 'Plugin failed with no error details',
      retryable: isRetryable('unknown'),
      suggestedAction: suggestAction('unknown'),
    }
  }

  const category = categoryFromErrorCode(result.errorCode) ?? categorizeError(errorText)
  const retryable = isRetryable(category)
  const action = suggestAction(category, errorText)

  return {
    category,
    message: result.error ?? 'Plugin installation failed',
    detail: errorText !== result.error ? errorText : undefined,
    retryable,
    suggestedAction: action,
  }
}
