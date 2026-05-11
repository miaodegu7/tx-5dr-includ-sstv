# DeepCW models

These are local DeepCW ONNX models used by the TX-5DR CW decoder.

Source: DeepCW demo at https://cw.e04.workers.dev/

The demo serves obfuscated model payloads from hashed URLs. The current English standard models were fetched from:

```text
en_tiny  https://cw.e04.workers.dev/51841bc5645f692122f8739380b989871ab572ea260d4ae71f94d1ad6d22e02e
en_small https://cw.e04.workers.dev/a786a4ab342a1cacfee51db3b37ccda1b64bcf98b8018d8bb53be1936f0468af
```

Decoded ONNX metadata:

```text
en_tiny.onnx
  input:  spectrogram float16 [batch, 1, time, 65]
  output: log_probs   float16 [batch, time, 42]
  sha256: 969bcedb9dd105f4382b1b6eefb49df22d9dd64befc223e7115e18e7ba37f687

en_small.onnx
  input:  spectrogram float32 [batch, 1, time, 65]
  output: log_probs   float32 [batch, time, 42]
  sha256: cf94e939cbdc10e2d2e6f2641a8fe6d8c68660f760f53b19d3a6bf4e121e7586
```

You can override the bundled model path with `TX5DR_DEEPCW_MODEL_PATH`.

## Runtime acceleration

TX-5DR uses `onnxruntime-node` for DeepCW inference. CPU is always available.
macOS can use CoreML, and Linux x64 can expose CUDA or experimental WebGPU
execution providers when the host GPU stack is already installed.

Linux GPU acceleration is intentionally self-managed: TX-5DR packages do not
install NVIDIA drivers, CUDA, cuDNN, or other system GPU libraries. For CUDA,
install the NVIDIA driver and CUDA v12 runtime required by `onnxruntime-node`;
if provider initialization fails, switch the CW decoder runtime back to CPU.
