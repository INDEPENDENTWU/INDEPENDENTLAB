class RewindPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buffer = new Int16Array(this.size);
    this.at = 0;
  }
  flush() {
    if (!this.at) return;
    const out = this.at === this.buffer.length ? this.buffer : this.buffer.slice(0, this.at);
    this.port.postMessage(out.buffer, [out.buffer]);
    this.buffer = new Int16Array(this.size);
    this.at = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i += 1) {
      const x = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.at++] = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      if (this.at === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor('rewind-pcm', RewindPCMProcessor);
