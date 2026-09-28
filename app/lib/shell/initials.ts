/** Avatar initials: first letters of the first and last word ("Ana Maria Silva" gives "AS"), one for a single word. */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean)
  const picked = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words
  // Array.from keeps surrogate pairs (emoji, rare scripts) whole.
  const letters = picked.map((word) => Array.from(word)[0]!.toLocaleUpperCase('en'))
  return letters.join('') || '?'
}
