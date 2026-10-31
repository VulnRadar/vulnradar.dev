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
  in `LOCALES`, `LOCALE_NAMES` and `LOCALE_ENGLISH_NAMES` (`config.ts`), then
  the command above.

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

The convention for a count is one message with the plural rule inside it, and
`other` always present (ICU requires it; a count no branch names throws):

```json
"findings": "{count, plural, =0 {No findings} one {# finding} other {# findings}}"
```

```tsx
t("findings", { count });
```

Every language writes the rule for its own forms but pluralises on the same
`{count}` argument; `key-parity.test.ts` checks both. `lib/ui/plural.ts`
(`pluralize(3, "member")`) is the English-only version for a surface that has
not moved to `t()`; do not use it under a translated heading.

## Formatting dates, times and numbers

`lib/ui/format-date.ts`, `relative-time.ts` and `plural.ts` print US English on
purpose and keep working: no call site has been moved. They are right for a
surface that is still English. Once a surface reads its words from `t()`, it
formats from here as well, since "5m ago" under a Japanese heading is the same
bug the other way round.

| Where the code runs                           | Use                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Client component, or a synchronous server one | `useFormatters()` from `hooks.ts`                                        |
| Async server component                        | `await getFormatters()` from `server.ts`                                 |
| No request (email, cron, webhook)             | `createFormatters(locale)` from `format.ts`, with the recipient's locale |

All three return the same object (`format.ts`):

```tsx
const fmt = useFormatters();
fmt.date(iso); // "Sep 16, 2026", "2026年9月16日"
fmt.dateTime(iso); // with the time; the clock follows the language
fmt.monthDay(iso); // "Sep 16"
fmt.relativeTime(iso, now); // "5 min. ago", "5 分前", a date past a week
fmt.number(count); // "1,234" or "1.234"; a numeric string is fine
fmt.compactNumber(count); // "1.2K"
fmt.percent(0.375); // "38%"
```

- **They return `null` for a value they cannot read**, where the English
  helpers return "Unknown date". The fallback wording is a translation, so the
  caller supplies it: `fmt.date(iso) ?? t("unknownDate")`.
- **`relativeTime` takes `now` as an argument** so a render stays pure. Read it
  with `useNow()` (`lib/ui/clock.ts`) instead of calling `Date.now()` in the
  component.
- **Time zones.** Left alone, a date prints in the runtime's own zone: the
  reader's in the browser, the server's (UTC) on the server. A client component
  is rendered once on the server too, so it prints in the server's zone first
  and the reader's at hydration, and the two disagree about the clock time (and
  about the date, for the hours when the zones are on different days). Format
  where the value only exists after mount, such as data the component fetches,
  or give both sides the same `{ timeZone }`.
- **Numbers and dates inside a sentence** stay values in the message
  (`{count}`, `{date}`) and are formatted by next-intl; use the formatters for a
  number or date that stands on its own in the page.

## Severity words

A severity is stored and sent over the API as `critical`, `high`, `medium`,
`low` or `info`. The word a reader sees is `result.severityCritical` and so
on, mapped in `severity.ts`:

```tsx
const severityLabel = useSeverityLabel(); // or await getSeverityLabel()
<Badge>{severityLabel(finding.severity)}</Badge>;
```

In a mail, `(await getSeverityLabeller(locale))(severity)` from `translate.ts`.
`SEVERITY_TONE[...].label` and `SEVERITY_LABELS` are the English words, for a
surface that has not been translated yet. A translated surface takes colour and
weight from `SEVERITY_TONE` and the word from here.
