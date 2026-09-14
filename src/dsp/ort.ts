import type { InferenceSession, Tensor } from 'onnxruntime-web';

// The slice of the ONNX Runtime API the models use. onnxruntime-web (browser worker) and
// onnxruntime-node (offline harness) share these types through onnxruntime-common, so the
// model wrappers run unchanged in both.
export type OrtSession = InferenceSession;
export type OrtTensor = Tensor;
export interface Ort {
  Tensor: typeof Tensor;
}
