class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      // Post a copy of the Float32 samples to the main thread
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
