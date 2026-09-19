# Translations

The language a reader gets is decided per request in `config.ts`: the
account's saved setting, then this browser's cookie, then `Accept-Language`,
then English. There are no locale-prefixed URLs, so every page keeps the
address it has and the ~750 generated `/checks` pages are generated once.

Adding a language is one file in `messages/` plus one entry in `LOCALES`.
A key that language has not translated yet falls back to English
(`messages.ts`), so a translation can land a few strings at a time and no page
ever renders a dotted key.

## What is not translated

Some things are the same in every language, and changing them makes the page
wrong rather than localized:

- **Numbers, dates and times.** They are not translated, they are _formatted_:
  `next-intl` renders them for the reader's locale (1,234 or 1.234), so write
  them as values (`{count}`, `{date}`), never as text inside a string.
- **The example domain and IP.** `example.com` and `203.0.113.10` are reserved
  for documentation (RFC 2606, RFC 5737) and are recognisable as examples
  everywhere. A translated `ejemplo.com` is a real domain somebody owns.
- **Anything the reader has to type or match exactly**: URLs and paths, HTTP
  header names and values, finding IDs, check IDs, CLI commands, code, config
  keys, environment variables, HTTP status codes, file names.
- **Names.** The product, the plans, and third-party services.
- **Severity keys in data.** The word shown to a reader is translated
  (`result.severityHigh`); the value stored in a scan and sent over the API is
  not.

The AI answers in the reader's language and is told the same rule (see
`lib/ai/system-prompt.ts`), so a finding ID or a header name in an answer
stays what it is.

## Writing a string

Put the whole sentence in one key. Do not build a sentence from fragments: the
order of the parts is different in German and Japanese, and a fragment cannot
be translated without knowing the sentence it lands in. Use a plural rule
(`{count, plural, ...}`) rather than an `if` around two strings, since some
languages have more than two forms.
