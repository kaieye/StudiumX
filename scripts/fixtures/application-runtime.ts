import assert from 'node:assert/strict'

import { createApplicationRuntime } from '../../src/main/application-runtime'

const calls: string[] = []
const bootingServices = { id: 'booting-services' }
const services = { id: 'application-services' }
const runtime = createApplicationRuntime({
  prepare: async () => {
    calls.push('prepare')
  },
  create: async () => {
    calls.push('create')
    return bootingServices
  },
  recover: async (created) => {
    assert.equal(created, bootingServices)
    calls.push('recover')
    return services
  },
  register: (created) => {
    assert.equal(created, services)
    calls.push('register')
  },
  open: (created) => {
    assert.equal(created, services)
    calls.push('open')
  },
  applyBehavior: (created) => {
    assert.equal(created, services)
    calls.push('apply')
  },
  activate: (created) => {
    assert.equal(created, services)
    calls.push('activate')
  },
  drain: async (created) => {
    assert.equal(created, services)
    calls.push('drain')
  }
})

assert.equal(runtime.beginShutdown(), null, 'a runtime without retained services cannot drain')
const initialStart = runtime.start()
assert.equal(runtime.start(), initialStart, 'concurrent starts share one boot')
await initialStart
runtime.activate()

assert.deepEqual(calls, ['prepare', 'create', 'recover', 'register', 'open', 'apply', 'activate'])

const firstDrain = runtime.beginShutdown()
assert.ok(firstDrain, 'the first quit begins a drain')
assert.equal(runtime.beginShutdown(), null, 'later before-quit events do not drain again')
await firstDrain
assert.deepEqual(calls, [
  'prepare',
  'create',
  'recover',
  'register',
  'open',
  'apply',
  'activate',
  'drain'
])

console.log('application runtime lifecycle ok')