// Batches the 128-sample render quanta into fixed-size mono chunks and posts them
// to the main thread, where all analysis happens (typed TypeScript, easy to tune).
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.size = opts.chunkSize || 1024;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    const right = input.length > 1 ? input[1] : null;
    for (let i = 0; i < left.length; i++) {
      this.buf[this.fill++] = right ? 0.5 * (left[i] + right[i]) : left[i];
      if (this.fill === this.size) {
        this.port.postMessage(this.buf);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
