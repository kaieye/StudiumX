/**
 * Zcode-compatible pairing crypto for web remote control (ADR-0143).
 *
 * - password: 24 random bytes base64url
 * - pass_hash: SHA-256(password) → standard base64
 * - proof: HMAC-SHA256(key=pass_hash, msg=`${nonce}|${role}|${deviceSid}`) → base64url
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'

export type WebRemoteControlPairingRole = 'device' | 'mobile'

export function createWebRemoteControlPassword(): string {
  return randomBytes(24).toString('base64url')
}

export function createWebRemoteControlPassHash(password: string): string {
  return createHash('sha256').update(password, 'utf8').digest('base64')
}

export function calculateWebRemoteControlProof(
  passHash: string,
  nonce: string,
  role: WebRemoteControlPairingRole,
  deviceSid: string
): string {
  return createHmac('sha256', passHash)
    .update(`${nonce}|${role}|${deviceSid}`, 'utf8')
    .digest('base64url')
}

export function verifyWebRemoteControlProof(options: {
  passHash: string
  nonce: string
  role: WebRemoteControlPairingRole
  deviceSid: string
  proof: string
}): boolean {
  if (!options.passHash || !options.nonce || !options.deviceSid || !options.proof) return false
  const expected = calculateWebRemoteControlProof(
    options.passHash,
    options.nonce,
    options.role,
    options.deviceSid
  )
  // Constant-time-ish compare for equal-length base64url strings.
  if (expected.length !== options.proof.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ options.proof.charCodeAt(i)
  }
  return diff === 0
}

export function createWebRemoteControlDeviceSid(): string {
  return randomBytes(16).toString('hex')
}

export function createWebRemoteControlNonce(): string {
  return randomBytes(16).toString('base64url')
}

/** QR / connect URL builder (no default cloud base). */
export function buildWebRemoteControlConnectUrl(options: {
  baseUrl: string
  deviceSid: string
  passHash: string
  timestamp?: number
  deviceMid?: string
  deviceName?: string
  appVersion?: string
}): string {
  const base = options.baseUrl.trim()
  if (!base) throw new Error('Web remote control connect baseUrl is empty')
  const url = new URL(base)
  url.searchParams.set('sid', options.deviceSid)
  url.searchParams.set('hash', options.passHash)
  url.searchParams.set('t', String(options.timestamp ?? Date.now()))
  if (options.deviceMid?.trim()) url.searchParams.set('mid', options.deviceMid.trim())
  if (options.deviceName?.trim()) url.searchParams.set('name', options.deviceName.trim())
  if (options.appVersion?.trim()) url.searchParams.set('app_version', options.appVersion.trim())
  return url.toString()
}
