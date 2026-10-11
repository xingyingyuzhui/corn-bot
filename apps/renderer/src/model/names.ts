/** Case- and whitespace-insensitive form used for search and uniqueness. */
export const normaliseName = (text: string) => text.trim().toLocaleLowerCase()

export const sameName = (a: string, b: string) =>
  normaliseName(a) === normaliseName(b)

/** Length in code points (what a person counts), after trimming. */
export const nameLength = (text: string) => [...text.trim()].length

/** First code point, so an emoji name never yields half a surrogate pair. */
export const initialOf = (name: string) => [...name.trim()][0] ?? ''
