/**
 * The only place with `/vendor/...` paths. `scripts/vendor-assets.mjs` copies these files from node_modules into
 * public/vendor/ (the model is committed), so the browser never fetches anything from another origin
 * (CSP `connect-src 'self'`; @livekit/track-processors would default to jsDelivr and storage.googleapis.com).
 */
export const VENDOR_PATHS = {
  /** MediaPipe tasks-vision 0.10.14 wasm directory (FilesetResolver picks the SIMD or no-SIMD build). */
  tasksVisionFileSet: '/vendor/mediapipe/wasm',
  /** Selfie segmenter, float16 (public/vendor/mediapipe/README.md). */
  modelAssetPath: '/vendor/mediapipe/selfie_segmenter.tflite',
  /** RNNoise AudioWorklet processor: a same-origin module file, never a blob: URL (CSP script-src has no blob:). */
  rnnoiseWorklet: '/vendor/rnnoise/workletProcessor.js',
  rnnoiseWasm: '/vendor/rnnoise/rnnoise.wasm',
  rnnoiseSimdWasm: '/vendor/rnnoise/rnnoise_simd.wasm',
} as const

/** `assetPaths` for `BackgroundProcessor` (always passed: the defaults point to CDNs). */
export const BLUR_ASSET_PATHS = {
  tasksVisionFileSet: VENDOR_PATHS.tasksVisionFileSet,
  modelAssetPath: VENDOR_PATHS.modelAssetPath,
} as const
