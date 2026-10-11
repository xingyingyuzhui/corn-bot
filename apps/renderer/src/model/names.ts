/** Case- and whitespace-insensitive form used for search and uniqueness. */
export const normaliseName = (text: string) => text.trim().toLocaleLowerCase()

export const sameName = (a: string, b: string) =>
  normaliseName(a) === normaliseName(b)

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' })

const charactersOf = (text: string) =>
  Array.from(graphemes.segment(text.trim()), (part) => part.segment)

/** Length in user-perceived characters (👨‍👩‍👧 and 🇨🇳 count once), after trimming. */
export const nameLength = (text: string) => charactersOf(text).length

/** First user-perceived character, so an emoji name never yields a fragment. */
export const initialOf = (name: string) => charactersOf(name)[0] ?? ''
