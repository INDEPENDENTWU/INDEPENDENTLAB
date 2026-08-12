class EchoCaptureProcessor extends AudioWorkletProcessor{
  process(inputs,outputs){
    const input=inputs[0]?.[0],output=outputs[0]?.[0];
    if(output)output.fill(0);
    if(input&&input.length){
      const out=new Float32Array(input.length);out.set(input);this.port.postMessage(out.buffer,[out.buffer]);
    }
    return true;
  }
}
registerProcessor('echo-capture',EchoCaptureProcessor);
