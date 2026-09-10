/**
 * Identity-tagged binary audio frames, browser side.
 *
 * The roleplay backend does not send bare PCM. Every audio chunk carries its
 * own identity in a header — which connection, session, turn and segment it
 * belongs to — so a chunk can never be mis-associated with "whatever metadata
 * arrived last", and so the client can acknowledge exactly what it played.
 *
 * This mirrors `src/services/custom-realtime/audio-frame.ts` on the server.
 * The layout is fixed and little-endian:
 *
 *   u16 magic 0x5341 ('SA') · u8 version · u8 flags (bit0 = final)
 *   u32 chunkSequence · u32 segmentSequence · u32 pcmByteLength
 *   5 × (u16 length + utf8 bytes): connectionId, sessionId, turnId,
 *     segmentId, audioSourceId
 *   pcm payload, exactly pcmByteLength bytes
 *
 * An untagged frame — anything that does not decode — is still playable as raw
 * PCM by the other pipelines; it simply cannot be acknowledged. That is why
 * `decodeAudioFrame` returns null rather than throwing: the caller falls back
 * to treating the whole buffer as samples.
 */

export const AUDIO_FRAME_MAGIC = 0x5341;
export const AUDIO_FRAME_VERSION = 1;

export interface AudioFrameHeader {
  version: number;
  connectionId: string;
  sessionId: string;
  turnId: string;
  segmentId: string;
  audioSourceId: string;
  /** The segment's position within its turn. */
  segmentSequence: number;
  /** This chunk's position within its segment. */
  chunkSequence: number;
  /** Set on the last chunk of a segment. */
  final: boolean;
  pcmByteLength: number;
}

/** The identity a playback_ack echoes back. */
export interface SegmentIdentity {
  connectionId: string;
  sessionId: string;
  turnId: string;
  segmentId: string;
  audioSourceId: string;
  sequence: number;
}

export interface DecodedAudioFrame {
  header: AudioFrameHeader;
  /** The samples, and nothing else — the header is not audio. */
  pcm: ArrayBuffer;
}

/**
 * Decode one frame, or null when it is not one of ours.
 *
 * Every inconsistency returns null rather than a partial read: a frame whose
 * declared PCM length disagrees with what arrived is corrupt, and playing the
 * bytes anyway is what produces the noise this decoder exists to prevent.
 */
export function decodeAudioFrame(buffer: ArrayBuffer): DecodedAudioFrame | null {
  try {
    if (buffer.byteLength < 16) return null;
    const view = new DataView(buffer);
    if (view.getUint16(0, true) !== AUDIO_FRAME_MAGIC) return null;

    const version = view.getUint8(2);
    if (version !== AUDIO_FRAME_VERSION) return null;

    const flags = view.getUint8(3);
    const chunkSequence = view.getUint32(4, true);
    const segmentSequence = view.getUint32(8, true);
    const pcmByteLength = view.getUint32(12, true);

    const decoder = new TextDecoder();
    const strings: string[] = [];
    let offset = 16;
    for (let i = 0; i < 5; i += 1) {
      if (offset + 2 > buffer.byteLength) return null;
      const length = view.getUint16(offset, true);
      offset += 2;
      if (offset + length > buffer.byteLength) return null;
      strings.push(decoder.decode(new Uint8Array(buffer, offset, length)));
      offset += length;
    }

    if (buffer.byteLength - offset !== pcmByteLength) return null;

    return {
      header: {
        version,
        final: (flags & 1) === 1,
        chunkSequence,
        segmentSequence,
        pcmByteLength,
        connectionId: strings[0],
        sessionId: strings[1],
        turnId: strings[2],
        segmentId: strings[3],
        audioSourceId: strings[4],
      },
      pcm: buffer.slice(offset),
    };
  } catch {
    return null;
  }
}

/** The identity to acknowledge, taken from a decoded frame. */
export function identityOf(header: AudioFrameHeader): SegmentIdentity {
  return {
    connectionId: header.connectionId,
    sessionId: header.sessionId,
    turnId: header.turnId,
    segmentId: header.segmentId,
    audioSourceId: header.audioSourceId,
    sequence: header.segmentSequence,
  };
}
