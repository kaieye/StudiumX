import assert from 'node:assert/strict'

import { TrayLifecycle } from '../../src/main/tray-lifecycle'

// Tray mode intercepts a normal window close and uses Chinese labels by default.
{
  const lifecycle = new TrayLifecycle()
  const configured = lifecycle.configure('tray')
  assert.equal(configured.trayEnabled, true)
  assert.deepEqual(configured.labels, { show: '显示 StudiumX', quit: '退出' })
  assert.equal(lifecycle.closeOutcome(), 'hide')
}

// Locale changes only affect labels; tray-mode close policy remains hide-to-tray.
{
  const lifecycle = new TrayLifecycle()
  const configured = lifecycle.configure('tray', 'en-US')
  assert.deepEqual(configured.labels, { show: 'Show StudiumX', quit: 'Quit' })
  assert.equal(lifecycle.closeOutcome(), 'hide')
}

// The tray stays present in either close mode; 'quit' only switches the close
// outcome to a normal close instead of hiding to the tray.
{
  const lifecycle = new TrayLifecycle()
  lifecycle.configure('tray', 'en-US')
  const quitMode = lifecycle.configure('quit')
  assert.equal(quitMode.trayEnabled, true)
  assert.equal(quitMode.locale, 'en-US')
  assert.equal(lifecycle.closeOutcome(), 'close')
}

// A real app quit overrides close-to-tray; clearing the override restores the configured outcome.
{
  const lifecycle = new TrayLifecycle()
  lifecycle.configure('tray')
  assert.equal(lifecycle.isQuitting(), false)
  lifecycle.beginQuit()
  assert.equal(lifecycle.isQuitting(), true)
  assert.equal(lifecycle.closeOutcome(), 'close')
  lifecycle.setQuitting(false)
  assert.equal(lifecycle.isQuitting(), false)
  assert.equal(lifecycle.closeOutcome(), 'hide')
}

console.log('tray lifecycle ok')