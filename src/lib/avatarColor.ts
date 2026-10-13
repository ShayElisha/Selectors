/** Stable palette class for a person's initials avatar. */
export function avatarColor(name: string): string {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase('he')) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  }
  return `avatar-tone-${hash % 8}`
}
