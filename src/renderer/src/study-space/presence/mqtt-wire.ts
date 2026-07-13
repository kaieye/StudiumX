/**
 * Small, deliberately transport-agnostic MQTT 3.1.1 byte helpers.
 *
 * MQTT packets travel one-per-WebSocket message in the public relay setup.  The
 * connection module owns deciding which packets matter; this module only owns
 * deterministic byte encoding and defensive parsing.
 */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const MQTT_MAX_REMAINING_LENGTH = 268_435_455

export type MqttPublish = {
  topic: string
  message: string
}

function encodeString(value: string): number[] {
  const encoded = encoder.encode(value)
  if (encoded.byteLength > 0xffff) throw new RangeError('MQTT string exceeds 65,535 bytes')
  return [encoded.byteLength >> 8, encoded.byteLength & 0xff, ...encoded]
}

export function mqttEncodeRemainingLength(length: number): number[] {
  if (!Number.isInteger(length) || length < 0 || length > MQTT_MAX_REMAINING_LENGTH) {
    throw new RangeError('MQTT remaining length is out of range')
  }

  const bytes: number[] = []
  let value = length
  do {
    let byte = value % 128
    value = Math.floor(value / 128)
    if (value > 0) byte |= 128
    bytes.push(byte)
  } while (value > 0)
  return bytes
}

function packet(type: number, variableHeader: number[] = [], payload: number[] = []): Uint8Array {
  const body = [...variableHeader, ...payload]
  return new Uint8Array([type, ...mqttEncodeRemainingLength(body.length), ...body])
}

export function mqttConnectPacket(clientId: string): Uint8Array {
  return packet(
    0x10,
    [...encodeString('MQTT'), 0x04, 0x02, 0x00, 0x2d],
    encodeString(clientId.slice(0, 48))
  )
}

export function mqttSubscribePacket(topic: string, packetId: number): Uint8Array {
  const normalizedPacketId = packetId & 0xffff
  return packet(
    0x82,
    [normalizedPacketId >> 8, normalizedPacketId & 0xff],
    [...encodeString(topic), 0x00]
  )
}

export function mqttPublishPacket(topic: string, message: string): Uint8Array {
  return packet(0x30, encodeString(topic), Array.from(encoder.encode(message)))
}

export function mqttPingRequestPacket(): Uint8Array {
  return new Uint8Array([0xc0, 0x00])
}

export function mqttPacketType(data: ArrayBuffer): number | null {
  const bytes = new Uint8Array(data)
  return bytes.length > 0 ? bytes[0] >> 4 : null
}

type RemainingLength = {
  value: number
  nextOffset: number
}

function readRemainingLength(bytes: Uint8Array, offset: number): RemainingLength | null {
  let multiplier = 1
  let value = 0

  for (let index = 0; index < 4; index += 1) {
    const cursor = offset + index
    if (cursor >= bytes.length) return null
    const byte = bytes[cursor]
    value += (byte & 127) * multiplier
    if ((byte & 128) === 0) return { value, nextOffset: cursor + 1 }
    multiplier *= 128
  }

  return null
}

function readString(bytes: Uint8Array, offset: number, packetEnd: number): { value: string; nextOffset: number } | null {
  if (offset + 2 > packetEnd) return null
  const length = (bytes[offset] << 8) + bytes[offset + 1]
  const start = offset + 2
  const end = start + length
  if (end > packetEnd) return null
  return { value: decoder.decode(bytes.slice(start, end)), nextOffset: end }
}

/**
 * Parses the first MQTT PUBLISH frame in a WebSocket message. Trailing MQTT
 * frames are kept outside the decoded payload, matching the relay's historic
 * one-message handling while still rejecting truncated or oversized frames.
 */
export function mqttParsePublish(data: ArrayBuffer, maxMessageBytes = Number.POSITIVE_INFINITY): MqttPublish | null {
  const bytes = new Uint8Array(data)
  if (bytes.length < 2 || (bytes[0] >> 4) !== 3) return null

  const flags = bytes[0] & 0x0f
  const qos = (flags >> 1) & 0x03
  if (qos === 3) return null

  const remaining = readRemainingLength(bytes, 1)
  if (!remaining) return null
  const packetEnd = remaining.nextOffset + remaining.value
  if (packetEnd > bytes.length) return null

  const topic = readString(bytes, remaining.nextOffset, packetEnd)
  if (!topic || !topic.value) return null

  let payloadOffset = topic.nextOffset
  if (qos > 0) {
    if (payloadOffset + 2 > packetEnd) return null
    const packetId = (bytes[payloadOffset] << 8) + bytes[payloadOffset + 1]
    if (packetId === 0) return null
    payloadOffset += 2
  }
  if (packetEnd - payloadOffset > maxMessageBytes) return null

  return {
    topic: topic.value,
    message: decoder.decode(bytes.slice(payloadOffset, packetEnd))
  }
}



