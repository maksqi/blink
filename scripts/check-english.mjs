#!/usr/bin/env node
/**
 * Fails when any tracked or new (not ignored) text file contains Cyrillic characters.
 * Everything in the blinq repository must be English. Tests that need non-Latin input use \u escapes.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Cyrillic, Cyrillic Supplement, Extended-C, Extended-A (combining marks) and Extended-B blocks.
// eslint-disable-next-line no-misleading-character-class -- ranges intentionally include combining marks
const CYRILLIC =/[\u0400-\u052F\u1C80-\u1C8F\u2DE0-\u2DFF\uA640-\uA69F]/
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|mp4|webm|mkv|mov|wav|mp3|ogg|opus|wasm|tflite|task|pdf|zip|gz|tgz|br|blq)$/i

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)

let findings = 0
for (const file of files) {
  if (BINARY.test(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // deleted in the working tree
  }
  if (!CYRILLIC.test(text)) continue
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (CYRILLIC.test(lines[i])) {
      findings++
      console.error(`${file}:${i + 1}: ${lines[i].trim().slice(0, 140)}`)
    }
  }
}

if (findings > 0) {
  console.error(`\ncheck-english: ${findings} line(s) contain Cyrillic characters. Everything in the repository must be English.`)
  process.exit(1)
}
console.log(`check-english: ${files.length} files OK`)
