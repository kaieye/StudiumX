/**
 * Fill-quiz answer normalization + digest identity (ADR-0155).
 *
 * One algorithm, three consumers:
 * - `assets/quiz.js` grades learner input in the published lesson (plaintext compare);
 * - the preview evidence bridge digests the learner's normalized input into a
 *   `fill-<sha256>` option id (safe-id grammar; no learner plaintext in evidence);
 * - the lesson renderer and outcome evaluator digest accepted answers so
 *   settlement can verify fill attempts against the trusted assessment sidecar.
 *
 * Both functions below are deliberately self-contained (no imports, no outer
 * references) so callers may inline them into injected browser scripts via
 * `String(fn)` — guaranteeing bit-identical normalization on every surface.
 */

/**
 * Canonical fill-answer normalization. Mirrors the published quiz.js grading
 * semantics exactly: trim → lowercase → collapse whitespace → strip common
 * CJK/ASCII sentence punctuation. (Punctuation stripping happens after
 * whitespace collapsing; that ordering is part of the frozen contract.)
 */
export function normalizeFillAnswer(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[。.,，！!？?]/g, '')
}

/**
 * Self-contained synchronous SHA-256 over the UTF-8 encoding of `text`,
 * returning lowercase hex. Used instead of SubtleCrypto because lesson
 * previews may run in non-secure-context frames where `crypto.subtle` is
 * unavailable; determinism and portability beat native speed here.
 */
export function sha256HexUtf8(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]
  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const bytes = new TextEncoder().encode(String(text ?? ''))
  const bitLenHi = Math.floor(bytes.length / 0x20000000)
  const bitLenLo = (bytes.length << 3) >>> 0
  const paddedLength = (Math.floor((bytes.length + 8) / 64) + 1) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  padded[paddedLength - 8] = (bitLenHi >>> 24) & 0xff
  padded[paddedLength - 7] = (bitLenHi >>> 16) & 0xff
  padded[paddedLength - 6] = (bitLenHi >>> 8) & 0xff
  padded[paddedLength - 5] = bitLenHi & 0xff
  padded[paddedLength - 4] = (bitLenLo >>> 24) & 0xff
  padded[paddedLength - 3] = (bitLenLo >>> 16) & 0xff
  padded[paddedLength - 2] = (bitLenLo >>> 8) & 0xff
  padded[paddedLength - 1] = bitLenLo & 0xff

  const w = new Array<number>(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4
      w[i] = ((padded[j]! << 24) | (padded[j + 1]! << 16) | (padded[j + 2]! << 8) | padded[j + 3]!) >>> 0
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15]!
      const w2 = w[i - 2]!
      const s0 = (((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)) >>> 0
      const s1 = (((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)) >>> 0
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let i = 0; i < 64; i += 1) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const hex = (value: number): string => value.toString(16).padStart(8, '0')
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7)
}

export const FILL_OPTION_ID_PREFIX = 'fill-' as const

export const FILL_OPTION_ID_PATTERN = /^fill-[a-f0-9]{64}$/

/**
 * Stable evidence/sidecar identity for a fill answer. Returns null when the
 * normalized answer is empty (never bind identity to an empty response).
 */
export function fillAnswerOptionId(raw: string): string | null {
  const normalized = normalizeFillAnswer(raw)
  if (!normalized) return null
  return `${FILL_OPTION_ID_PREFIX}${sha256HexUtf8(normalized)}`
}

export function isFillOptionId(value: string): boolean {
  return FILL_OPTION_ID_PATTERN.test(value)
}

/**
 * Deduplicated accepted-answer option ids for a fill quiz item (primary answer
 * first, then alternates), capped to the sidecar id-list bound.
 */
export function fillAcceptedOptionIds(primary: string, accepted: readonly string[], maxIds = 6): string[] {
  const ids: string[] = []
  for (const candidate of [primary, ...accepted]) {
    const id = fillAnswerOptionId(String(candidate ?? ''))
    if (!id || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= maxIds) break
  }
  return ids
}
