// Owns the AudioContext and whichever source is live (microphone, a decoded file, a sample clip).
// Every source feeds the same capture worklet, so analysis is identical for all of them.
export type SourceKind = 'none' | 'mic' | 'file';

const CHUNK = 1024;

export class AudioEngine {
  ctx: AudioContext | null = null;
  kind: SourceKind = 'none';
  deviceName = '';
  onChunk: (chunk: Float32Array, sampleRate: number) => void = () => {};
  onSourceChange: () => void = () => {};

  private worklet: AudioWorkletNode | null = null;
  private monitorGain: GainNode | null = null;
  private monitorOn = true;
  private current: { stop: () => void } | null = null;

  private async ensure(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklet/capture-processor.js`);
    const node = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkSize: CHUNK },
    });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onChunk(e.data, ctx.sampleRate);
    // A silent sink keeps the worklet inside the rendering graph.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    const monitor = ctx.createGain();
    monitor.gain.value = this.monitorOn ? 1 : 0;
    monitor.connect(ctx.destination);
    this.ctx = ctx;
    this.worklet = node;
    this.monitorGain = monitor;
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  private stopCurrent(): void {
    this.current?.stop();
    this.current = null;
    this.kind = 'none';
  }

  async useMic(): Promise<void> {
    const ctx = await this.ensure();
    // Browser processing would flatten exactly what we measure.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    });
    this.stopCurrent();
    const src = ctx.createMediaStreamSource(stream);
    src.connect(this.worklet!);
    this.current = {
      stop: () => {
        src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
      },
    };
    this.kind = 'mic';
    this.deviceName = stream.getAudioTracks()[0]?.label ?? '';
    this.onSourceChange();
  }

  async useFile(file: File): Promise<void> {
    const ctx = await this.ensure();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    this.play(buffer);
  }

  async useUrl(url: string): Promise<void> {
    const ctx = await this.ensure();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url}`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    this.play(buffer);
  }

  private play(buffer: AudioBuffer): void {
    const ctx = this.ctx!;
    this.stopCurrent();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.worklet!);
    src.connect(this.monitorGain!);
    src.start();
    this.current = {
      stop: () => {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
      },
    };
    this.kind = 'file';
    this.onSourceChange();
  }

  setMonitor(on: boolean): void {
    this.monitorOn = on;
    if (this.monitorGain && this.ctx) {
      this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  stop(): void {
    this.stopCurrent();
    this.onSourceChange();
  }
}
