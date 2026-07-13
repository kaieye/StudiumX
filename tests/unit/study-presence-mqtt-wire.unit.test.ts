import { describe, expect, it } from 'vitest'
import {
  mqttConnectPacket,
  mqttEncodeRemainingLength,
  mqttParsePublish,
  mqttPingRequestPacket,
  mqttPublishPacket,
  mqttSubscribePacket
} from '@renderer/study-space/presence/mqtt-wire'

function bytes(packet: Uint8Array): number[] {
  return Array.from(packet)
}

function buffer(packet: number[]): ArrayBuffer {
  return new Uint8Array(packet).buffer
}

describe('MQTT wire packets', () => {
  it('encodes stable MQTT 3.1.1 connect, subscribe, publish, and ping vectors', () => {
    expect(bytes(mqttConnectPacket('client'))).toEqual([
      0x10, 0x12,
      0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x2d,
      0x00, 0x06, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74
    ])
    expect(bytes(mqttSubscribePacket('a/b', 1))).toEqual([0x82, 0x08, 0x00, 0x01, 0x00, 0x03, 0x61, 0x2f, 0x62, 0x00])
    expect(bytes(mqttPublishPacket('t', 'hi'))).toEqual([0x30, 0x05, 0x00, 0x01, 0x74, 0x68, 0x69])
    expect(bytes(mqttPingRequestPacket())).toEqual([0xc0, 0x00])
  })

  it.each([
    [0, [0x00]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [16_383, [0xff, 0x7f]],
    [16_384, [0x80, 0x80, 0x01]],
    [268_435_455, [0xff, 0xff, 0xff, 0x7f]]
  ])('encodes MQTT remaining length %i', (length, expected) => {
    expect(mqttEncodeRemainingLength(length)).toEqual(expected)
  })

  it('parses QoS 0 and QoS 1 PUBLISH payload vectors', () => {
    expect(mqttParsePublish(buffer([0x30, 0x05, 0x00, 0x01, 0x74, 0x68, 0x69]))).toEqual({ topic: 't', message: 'hi' })
    expect(mqttParsePublish(buffer([0x32, 0x07, 0x00, 0x01, 0x74, 0x00, 0x07, 0x68, 0x69]))).toEqual({ topic: 't', message: 'hi' })
  })

  it('keeps the first PUBLISH frame isolated from trailing MQTT frames and honors payload caps', () => {
    const publishWithPing = buffer([0x30, 0x05, 0x00, 0x01, 0x74, 0x68, 0x69, 0xc0, 0x00])
    expect(mqttParsePublish(publishWithPing)).toEqual({ topic: 't', message: 'hi' })
    expect(mqttParsePublish(buffer([0x30, 0x07, 0x00, 0x01, 0x74, 0x68, 0x65, 0x6c, 0x6c]), 3)).toBeNull()
  })
  it.each([
    [[], 'empty frame'],
    [[0x30], 'truncated fixed header'],
    [[0x30, 0x80], 'unterminated remaining length'],
    [[0x30, 0x80, 0x80, 0x80, 0x80], 'five-byte remaining length'],
    [[0x30, 0x05, 0x00, 0x01, 0x74], 'truncated payload'],
    [[0x36, 0x05, 0x00, 0x01, 0x74, 0x68, 0x69], 'invalid QoS bits']
  ])('rejects malformed PUBLISH frames: %s', (packet) => {
    expect(mqttParsePublish(buffer(packet))).toBeNull()
  })
})


