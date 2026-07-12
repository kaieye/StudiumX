import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-doctor-'))

try {
  await mkdir(tempRoot, { recursive: true })
  await writeFile(
    join(tempRoot, 'studiumx-settings.json'),
    `${JSON.stringify({
      version: 1,
      provider: {
        activeProviderId: 'custom',
        providers: [
          {
            id: 'custom',
            name: 'Secret Provider',
            baseUrl: 'https://user:password@example.com/v1?api_key=sk-should-not-leak',
            endpointFormat: 'chat_completions',
            models: ['secret-model'],
            apiKey: 'sk-should-not-leak'
          }
        ],
        proxy: {
          enabled: true,
          url: 'https://proxy.example.test?token=proxy-should-not-leak'
        }
      },
      generator: {
        providerId: 'custom',
        model: 'secret-model',
        endpointFormat: 'chat_completions'
      },
      workspace: {
        defaultRoot: join(tempRoot, 'workspace')
      },
      worktree: {
        rootPath: join(tempRoot, 'workspace', '.worktrees')
      },
      tools: {
        enabled: true,
        workspaceRead: true,
        workspaceWritePermission: 'ask_each_time',
        webSearch: true,
        webFetch: true,
        maxIterations: 8
      },
      privacy: {
        maskApiKeys: true,
        allowExternalLinks: true
      },
      log: {
        enabled: true,
        retentionDays: 14
      },
      webSearch: {
        braveApiKey: 'brave-should-not-leak',
        tavilyApiKey: 'tavily-should-not-leak'
      }
    }, null, 2)}\n`,
    { mode: 0o600 }
  )

  const result = spawnSync(
    process.execPath,
    ['scripts/doctor.mjs', '--json', '--no-checks', '--user-data', tempRoot],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  const output = result.stdout
  assert.doesNotMatch(output, /sk-should-not-leak/)
  assert.doesNotMatch(output, /proxy-should-not-leak/)
  assert.doesNotMatch(output, /brave-should-not-leak/)
  assert.doesNotMatch(output, /tavily-should-not-leak/)

  const snapshot = JSON.parse(output)
  assert.equal(snapshot.settings.storage, 'json_file')
  assert.equal(snapshot.settings.keyStorage, 'settings_json')
  assert.equal(snapshot.settings.keychainMigration, 'not_implemented')
  assert.equal(snapshot.settings.provider.providerCount, 1)
  assert.deepEqual(snapshot.securityChecks, [])
  assert.equal(snapshot.diagnostics.workspaceContent, 'not_included')

  console.log('doctor redacted snapshot ok')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
