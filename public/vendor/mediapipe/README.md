# Vendored MediaPipe assets

`selfie_segmenter.tflite` is the only file in `public/vendor/` that is committed. Everything else here
(`wasm/`) and in `public/vendor/rnnoise/` is copied from `node_modules` by `scripts/vendor-assets.mjs` before every dev
start and build, and is git-ignored.

## selfie_segmenter.tflite

| Field | Value |
|---|---|
| What | MediaPipe selfie segmenter, float16 (the default model of `@livekit/track-processors` 0.8 `BackgroundProcessor`) |
| Source URL | https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite |
| Version | `latest` as of 2026-10-03: GCS generation 1683436453600523, last modified 2023-05-07 05:14:13 GMT, ETag `3b2e3e1cfc7d31538caf00ff4e0fba8c` |
| Size | 249537 bytes |
| sha256 | `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b` |
| License | Apache-2.0 (MediaPipe models, https://github.com/google-ai-edge/mediapipe) |
| Used by | `app/lib/media/vendor-paths.ts` → `modelAssetPath: '/vendor/mediapipe/selfie_segmenter.tflite'` |

It was downloaded once by hand during development. The app, the browser and the vendor script never fetch it (or
anything else) from another origin: the CSP allows `connect-src 'self'` only.

`scripts/vendor-assets.mjs` checks the sha256 above on every run and fails when the file is missing or different. To
update the model, download the new file by hand, verify it, and change the hash in this README and in the script
(`MODEL_SHA256`) in the same commit.

## wasm/ (generated)

`vision_wasm_internal.{js,wasm}` and `vision_wasm_nosimd_internal.{js,wasm}` from `@mediapipe/tasks-vision` 0.10.14
(Apache-2.0), the exact version `@livekit/track-processors` 0.8 depends on. The vendor script refuses any other version
(docs/SECURITY.md §9: 1.x is reported to send telemetry).
