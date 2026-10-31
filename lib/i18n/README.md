# Translations

The language a reader gets is decided per request in `config.ts`: the
account's saved setting, then this browser's cookie, then `Accept-Language`,
then English. There are no locale-prefixed URLs, so every page keeps the
address it has and the ~750 generated `/checks` pages are generated once.

## Where the words live

One JSON file per language and namespace: `messages/<locale>/<namespace>.json`,
where the namespace is what a component passes to `useTranslations("nav")` and
the file holds that namespace's keys directly (`nav.json` starts with
`"scanner": "Scanner"`, not with `"nav"`). Splitting them means the people
translating one surface edit that surface's files and nobody else's.

- **A new string** goes in `en/<namespace>.json` and in the same file of every
  other language, in the same change. `tests/lib/i18n/key-parity.test.ts` fails
  on a language that is missing a key or has one English does not.
- **A new namespace** is a new file in each language folder, named in camelCase
  (`aiChat.json`). Then regenerate the list of imports:

  ```
  node lib/i18n/build-catalog.mjs
  ```

  `messages/catalog.ts` is that list. The imports have to be static (see
  `messages.ts`), which is why a list exists at all. It is generated so that two
  changes adding a namespace each cannot conflict on it: after merging, run the
  command again. `tests/lib/i18n/catalog.test.ts` fails while it is out of date.

- **A new language** is a new folder with a file for every namespace, one entry
  in `LOCALES` (`config.ts`) and one in `LOCALE_NAMES`, then the command above.

A key a language lacks still falls back to English at runtime (`messages.ts`),
so one that slips past review reads in English and never renders as a dotted
key. That is the safety net, not the plan: the parity test is what keeps every
language complete.

`key-parity.test.ts` also lists the English keys that no file under `app/`,
`components/`, `hooks/` or `lib/` refers to. It is a report and never fails:
a key waiting for the component that reads it is normal, and the list is how
you find the ones that never got one. Delete a key only after reading the list
and checking the surface really is gone.

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
