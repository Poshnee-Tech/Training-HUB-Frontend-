/**
 * PCM capture worklet. Runs on the audio rendering thread and posts
 * Int16 PCM frames back to the main thread.
 *
 * Legacy mode suppresses mic frames while TTS is playing. Deepgram Agent mode
 * keeps the mic hot so Deepgram owns interruption/barge-in detection.
 */

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 800 samples = 50ms at 16kHz. Smaller frames reach STT sooner (snappier
    // captions and end-of-turn) at a negligible message-rate cost (20/s).
    this._buf = new Int16Array(800);
    this._fill = 0;
    this._muted = false;
    this._speaking = false;
    this._bargeInMode = false;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'state') {
        this._muted = !!e.data.muted;
        this._speaking = !!e.data.speaking;
        this._bargeInMode = !!e.data.bargeInMode;
      }
    };
  }

  process(inputs) {
    if (!inputs[0] || !inputs[0][0]) return true;

    if (this._muted || (this._speaking && !this._bargeInMode)) {
      this._fill = 0;
      return true;
    }

    const input = inputs[0][0];
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this._buf[this._fill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._fill === this._buf.length) {
        const out = this._buf.slice(0);
        this.port.postMessage(out.buffer, [out.buffer]);
        this._fill = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
