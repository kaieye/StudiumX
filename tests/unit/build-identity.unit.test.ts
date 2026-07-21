import { afterEach, describe, expect, it } from 'vitest'

import {
  DECLARED_NODE_ENGINE,
  UNKNOWN_SOURCE_REV,
  readBuildIdentity,
  resolveSourceRev,
  sanitizeSourceRev
} from '../../src/shared/build-identity'

describe('sanitizeSourceRev', () => {
  it('accepts short hex / git-like revs', () => {
    expect(sanitizeSourceRev('abc1234')).toBe('abc1234')
    expect(sanitizeSourceRev('v0.1.0-12-gabcdef0')).toBe('v0.1.0-12-gabcdef0')
    expect(sanitizeSourceRev('  deadbeef  ')).toBe('deadbeef')
  })

  it('rejects empty, path-like, overlong, or unsafe values', () => {
    expect(sanitizeSourceRev('')).toBeNull()
    expect(sanitizeSourceRev('   ')).toBeNull()
    expect(sanitizeSourceRev(null)).toBeNull()
    expect(sanitizeSourceRev(12)).toBeNull()
    expect(sanitizeSourceRev('/abs/path')).toBeNull()
    expect(sanitizeSourceRev('C:\\Users\\me')).toBeNull()
    expect(sanitizeSourceRev('..\\secret')).toBeNull()
    expect(sanitizeSourceRev('https://evil.example/rev')).toBeNull()
    expect(sanitizeSourceRev('has space')).toBeNull()
    expect(sanitizeSourceRev('a'.repeat(65))).toBeNull()
  })
})

describe('resolveSourceRev precedence', () => {
  it('prefers SOURCE_REV over GITHUB_SHA and GIT_DESCRIBE', () => {
    expect(
      resolveSourceRev({
        SOURCE_REV: 'src-explicit',
        GITHUB_SHA: 'gh-sha',
        GIT_DESCRIBE: 'v1.0.0'
      })
    ).toBe('src-explicit')
  })

  it('falls back to GITHUB_SHA then GIT_DESCRIBE then unknown', () => {
    expect(resolveSourceRev({ GITHUB_SHA: 'gh-sha', GIT_DESCRIBE: 'v1.0.0' })).toBe('gh-sha')
    expect(resolveSourceRev({ GIT_DESCRIBE: 'v1.0.0-3-gabc' })).toBe('v1.0.0-3-gabc')
    expect(resolveSourceRev({})).toBe(UNKNOWN_SOURCE_REV)
    expect(resolveSourceRev({ SOURCE_REV: '/bad', GITHUB_SHA: '  ', GIT_DESCRIBE: null as unknown as string })).toBe(
      UNKNOWN_SOURCE_REV
    )
  })

  it('skips invalid earlier candidates', () => {
    expect(
      resolveSourceRev({
        SOURCE_REV: '../escape',
        GITHUB_SHA: 'validsha',
        GIT_DESCRIBE: 'ignored'
      })
    ).toBe('validsha')
  })
})

describe('readBuildIdentity', () => {
  const original = {
    SOURCE_REV: process.env.SOURCE_REV,
    GITHUB_SHA: process.env.GITHUB_SHA,
    GIT_DESCRIBE: process.env.GIT_DESCRIBE,
    NODE_ENGINE: process.env.NODE_ENGINE
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('returns declared node engine and unknown when env empty', () => {
    const identity = readBuildIdentity({})
    expect(identity).toEqual({
      sourceRev: UNKNOWN_SOURCE_REV,
      nodeEngine: DECLARED_NODE_ENGINE
    })
  })

  it('accepts injected env without reading process.env when passed explicitly', () => {
    process.env.SOURCE_REV = 'should-not-leak-from-process'
    const identity = readBuildIdentity({
      SOURCE_REV: 'build-rev-1',
      NODE_ENGINE: '>=22 <25'
    })
    expect(identity.sourceRev).toBe('build-rev-1')
    expect(identity.nodeEngine).toBe('>=22 <25')
  })

  it('never throws on hostile env and stays path-free', () => {
    const identity = readBuildIdentity({
      SOURCE_REV: 'C:\\Users\\secret\\repo',
      GITHUB_SHA: 'https://example.com/x',
      GIT_DESCRIBE: 'a'.repeat(100),
      NODE_ENGINE: '/etc/passwd'
    })
    expect(identity.sourceRev).toBe(UNKNOWN_SOURCE_REV)
    expect(identity.nodeEngine).toBe(DECLARED_NODE_ENGINE)
    expect(JSON.stringify(identity)).not.toMatch(/Users|passwd|https:/)
  })
})
