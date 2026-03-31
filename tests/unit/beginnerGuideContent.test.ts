/**
 * beginnerGuideContent 的结构化内容测试。
 */

import { describe, expect, it } from 'vitest'

import {
  beginnerGuideTopics,
  getBeginnerGuideTopic,
  type BeginnerGuideToolId,
} from '../../src/renderer/beginnerGuideContent'

describe('beginnerGuideContent', () => {
  it('contains overview plus every supported tool topic', () => {
    const ids = beginnerGuideTopics.map((topic) => topic.id)

    expect(ids).toEqual(['overview', 'node', 'java', 'python', 'git', 'mysql', 'redis', 'maven'])
  })

  it('gives every non-overview tool the expected major sections', () => {
    const toolIds = beginnerGuideTopics
      .filter((topic) => topic.id !== 'overview')
      .map((topic) => topic.id)

    for (const toolId of toolIds) {
      const topic = getBeginnerGuideTopic(toolId)
      const sectionIds = topic.sections.map((section) => section.id)

      expect(sectionIds).toContain('overview')
      expect(sectionIds).toContain('commands')
      expect(sectionIds).toContain('env-and-paths')
      expect(sectionIds).toContain('troubleshooting')
      expect(topic.sections.every((section) => section.cards.length > 0)).toBe(true)
    }
  })

  it('keeps key environment variables in the right tool topics', () => {
    const expectedEnvVars: Record<
      Exclude<BeginnerGuideToolId, 'overview' | 'git'> | 'git',
      string[]
    > = {
      node: ['PATH', 'NVM_DIR', 'npm_config_cache', 'npm_config_prefix'],
      java: ['JAVA_HOME', 'PATH'],
      python: ['PATH', 'CONDA_PREFIX'],
      git: ['PATH'],
      mysql: ['MYSQL_HOME', 'PATH'],
      redis: ['REDIS_HOME', 'PATH'],
      maven: ['MAVEN_HOME', 'M2_HOME', 'PATH'],
    }

    for (const [toolId, envVarNames] of Object.entries(expectedEnvVars)) {
      const topic = getBeginnerGuideTopic(toolId as BeginnerGuideToolId)
      const names = topic.sections.flatMap((section) =>
        section.cards.flatMap((card) => (card.envVars ?? []).map((item) => item.name)),
      )

      for (const envVarName of envVarNames) {
        expect(names).toContain(envVarName)
      }
    }
  })

  it('falls back to overview when an unknown topic id is requested', () => {
    const fallbackTopic = getBeginnerGuideTopic('unknown-tool' as BeginnerGuideToolId)
    expect(fallbackTopic.id).toBe('overview')
  })
})
