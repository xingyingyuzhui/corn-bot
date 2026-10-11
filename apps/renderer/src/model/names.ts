/** Case- and whitespace-insensitive form used for search and uniqueness. */
export const normaliseName = (text: string) => text.trim().toLocaleLowerCase()

export const sameName = (a: string, b: string) =>
  normaliseName(a) === normaliseName(b)

/** First code point, so an emoji name never yields half a surrogate pair. */
export const initialOf = (name: string) => [...name.trim()][0] ?? ''
