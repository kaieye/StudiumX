import { describe, expect, it } from 'vitest'

import { createApplicationRuntime } from '../../src/main/application-runtime'

describe('application runtime lifecycle contract', () => {
  it('boots once in durable-data, recovery, exposure, window, behavior order and retains its services', async () => {
    const calls: string[] = []
    const bootingServices = { id: 'booting-services' }
    const services = { id: 'runtime-services' }
    const runtime = createApplicationRuntime({
      prepare: async () => {
        calls.push('prepare')
      },
      create: async () => {
        calls.push('create')
        return bootingServices
      },
      recover: async (created) => {
        expect(created).toBe(bootingServices)
        calls.push('recover')
        return services
      },
      register: (created) => {
        expect(created).toBe(services)
        calls.push('register')
      },
      open: (created) => {
        expect(created).toBe(services)
        calls.push('open')
      },
      applyBehavior: (created) => {
        expect(created).toBe(services)
        calls.push('apply')
      },
      activate: (created) => {
        expect(created).toBe(services)
        calls.push('activate')
      },
      drain: async (created) => {
        expect(created).toBe(services)
        calls.push('drain')
      }
    })

    runtime.activate()
    const firstStart = runtime.start()
    const secondStart = runtime.start()

    expect(secondStart).toBe(firstStart)
    await firstStart
    runtime.activate()

    expect(calls).toEqual(['prepare', 'create', 'recover', 'register', 'open', 'apply', 'activate'])
  })

  it('drains only the first real quit after services exist', async () => {
    const calls: string[] = []
    const runtime = createApplicationRuntime({
      prepare: async () => {
        calls.push('prepare')
      },
      create: async () => {
        calls.push('create')
        return { id: 'runtime-services' }
      },
      recover: async (created) => {
        calls.push('recover')
        return created
      },
      register: () => {
        calls.push('register')
      },
      open: () => {
        calls.push('open')
      },
      applyBehavior: () => {
        calls.push('apply')
      },
      activate: () => {
        calls.push('activate')
      },
      drain: async () => {
        calls.push('drain')
      }
    })

    expect(runtime.beginShutdown()).toBeNull()
    await runtime.start()

    const firstDrain = runtime.beginShutdown()
    expect(firstDrain).not.toBeNull()
    expect(runtime.beginShutdown()).toBeNull()
    await firstDrain

    expect(calls).toEqual(['prepare', 'create', 'recover', 'register', 'open', 'apply', 'drain'])
  })
})