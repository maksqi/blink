#!/usr/bin/env node
/**
 * Copies the self-hosted browser assets for background blur and noise suppression from node_modules into
 * public/vendor/ (docs/stages/07-media-processing.md). Runs before every dev start and build (`pnpm vendor`).
 *
 * - No network access: everything comes from installed packages, except the selfie segmenter model, which is committed
 *   (public/vendor/mediapipe/README.md) and verified against MODEL_SHA256 here.
 * - Idempotent: a file is copied only when the target is missing or differs.
 * - Fails with a clear message when a source file is missing, when @mediapipe/tasks-vision is not exactly
 *   TASKS_VISION_VERSION (1.x is reported to send telemetry) or when the committed model's hash differs.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const TASKS_VISION_VERSION = '0.10.14'
const MODEL_SHA256 = '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'public', 'vendor')
const problems = []

/** Directory of an installed package as `from` resolves it (package exports hide package.json, so use the entry). */
function packageDir(requireFrom, name, entryDepth) {
  try {
    let dir = dirname(requireFrom.resolve(name))
    for (let i = 0; i < entryDepth; i++) dir = dirname(dir)
    return dir
  } catch {
    problems.push(`${name} is not installed. Run pnpm install.`)
    return null
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sameFile(source, target) {
  if (!existsSync(target)) return false
  if (statSync(source).size !== statSync(target).size) return false
  return sha256(source) === sha256(target)
}

const rootRequire = createRequire(join(root, 'package.json'))

// MediaPipe: the copy track-processors itself imports (its wasm must match the JS bundled into the app).
const processorsDir = packageDir(rootRequire, '@livekit/track-processors', 1) // dist/index.js
const visionDir = processorsDir
  ? packageDir(createRequire(join(processorsDir, 'package.json')), '@mediapipe/tasks-vision', 0) // vision_bundle.*
  : null
const topVisionDir = packageDir(rootRequire, '@mediapipe/tasks-vision', 0)
for (const dir of new Set([visionDir, topVisionDir].filter(Boolean))) {
  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
  if (version !== TASKS_VISION_VERSION) {
    problems.push(
      `@mediapipe/tasks-vision ${version} is installed (${relative(root, dir)}), but blinq needs exactly ` +
        `${TASKS_VISION_VERSION} (docs/SECURITY.md §9). Fix the pin and run pnpm install.`,
    )
  }
}

// RNNoise: the worklet and both wasm builds (SIMD and plain).
const noiseDist = packageDir(rootRequire, '@sapphi-red/web-noise-suppressor', 0) // dist/index.cjs

const files = []
if (visionDir) {
  for (const name of [
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
  ]) {
    files.push({ source: join(visionDir, 'wasm', name), target: join(vendor, 'mediapipe', 'wasm', name) })
  }
}
if (noiseDist) {
  files.push(
    {
      source: join(noiseDist, 'rnnoise', 'workletProcessor.js'),
      target: join(vendor, 'rnnoise', 'workletProcessor.js'),
    },
    { source: join(noiseDist, 'rnnoise.wasm'), target: join(vendor, 'rnnoise', 'rnnoise.wasm') },
    { source: join(noiseDist, 'rnnoise_simd.wasm'), target: join(vendor, 'rnnoise', 'rnnoise_simd.wasm') },
  )
}
for (const { source } of files) {
  if (!existsSync(source)) problems.push(`Missing source file ${relative(root, source)}. Reinstall dependencies.`)
}

const model = join(vendor, 'mediapipe', 'selfie_segmenter.tflite')
if (!existsSync(model)) {
  problems.push(
    `Missing ${relative(root, model)}. It is committed to the repository; restore it with git (see ` +
      'public/vendor/mediapipe/README.md).',
  )
} else {
  const actual = sha256(model)
  if (actual !== MODEL_SHA256) {
    problems.push(
      `${relative(root, model)} has sha256 ${actual}, expected ${MODEL_SHA256}. Restore the committed model ` +
        '(public/vendor/mediapipe/README.md).',
    )
  }
}

if (problems.length > 0) {
  console.error(`vendor-assets: failed\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
  process.exit(1)
}

let copied = 0
for (const { source, target } of files) {
  if (sameFile(source, target)) continue
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  copied++
}

console.log(
  `vendor-assets: ${files.length} files in public/vendor (${copied} copied, ${files.length - copied} up to date), ` +
    `@mediapipe/tasks-vision ${TASKS_VISION_VERSION}, model sha256 ok`,
)
