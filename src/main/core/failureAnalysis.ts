import type { FailureAnalysis, FailureCategory, PluginInstallResult } from './contracts'

/**
 * 分类错误信息
 * 从错误字符串中识别失败类型
 */
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

  if (
    msg.includes('already exists') ||
    msg.includes('eexist') ||
    msg.includes('conflict')
  ) {
    return 'conflict'
  }

  if (
    msg.includes('not found') ||
    msg.includes('command not found') ||
    msg.includes('enoent') ||
    msg.includes('missing')
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
  const errorText =
    result.error ?? result.logs.slice(-5).join('\n')

  if (!errorText) {
    return {
      category: 'unknown',
      message: 'Plugin failed with no error details',
      retryable: isRetryable('unknown'),
      suggestedAction: suggestAction('unknown'),
    }
  }

  const category = categorizeError(errorText)
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
