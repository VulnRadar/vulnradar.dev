# VulnRadar brand kit

The logo, the lockup and the colours, as files you can drop straight in. Use
them when you write about VulnRadar, link to it, or show that something works
with it. The same kit, with live examples, is at https://vulnradar.dev/brand.

## The short version

| | |
|---|---|
| **Logo** | A navy disc with a radar sweep. Use the mark on its own when space is tight. |
| **Clear space** | X on every side, where X is a quarter of the disc's diameter. |
| **Minimum size** | Mark 16 px. Lockup 96 px wide. Below that, the mark alone. |
| **Never** | Recolour, stretch, rotate, add a shadow or an outline, or set the wordmark in a font. |
| **Wordmark** | JetBrains Mono SemiBold, outlined to paths. You do not need the font. |
| **Background** | None. Every file is transparent except the two `-navy` avatars. |

## What is in here

```
logo/      the mark on its own, 13 sizes:
           16, 32, 48, 64, 96, 128, 144, 152, 180, 192, 256, 512, 1024 px
lockup/    mark and wordmark, 14 slots, each in two variants:
           970x250, 970x90, 728x90, 468x60, 320x100, 320x50, 234x60,
           300x250, 300x600, 1200x630, 1200x300, 1500x500, 960x540, 1920x600
profile/   avatars: the disc filling the square, transparent corners,
           plus two opaque navy ones
source/    SVG: the mark, the wordmark, and the lockups
```

File names follow one pattern, so you never have to guess:

```
vulnradar-logo-512x512.png
vulnradar-lockup-on-dark-1500x500.png
vulnradar-profile-1024x1024-navy.png
```

## Which one do I want?

- **A favicon, an app icon, a small square:** `logo/`. Use the size at or
  above the one you need.
- **An avatar:** `profile/`. Use a `-navy` file only where the slot
  flattens transparency: a JPEG, a video call, an App Store icon.
- **A header, a banner, a social card:** `lockup/`. `on-dark` has a light
  wordmark for dark backgrounds, `on-light` a navy one for light
  backgrounds. 300x250 and 300x600 are stacked, mark above wordmark; the
  rest are horizontal.
- **Print, or a size we do not ship:** `source/*.svg`.

Every lockup PNG is the exact slot size with the lockup centred and at least
the clear space around it, so it can be dropped in without cropping.

## Colours in the logo

| Part | Hex | Where |
|---|---|---|
| Disc | `#0f172a` | The disc everything sits on |
| Sweep | `#3b82f6` | The two filled sectors, at 20% and 40% opacity |
| Arcs | `#60a5fa` | The radar arcs and the centre dot |
| Beam | `#ffffff` | The sweep line |
| Contacts | `#fbbf24` | The two blips on the scope |

The wordmark is `#f1f5f9` on dark backgrounds and `#0f172a` on light ones.
The mark never changes colour.

## The wordmark

"VulnRadar" is set in JetBrains Mono SemiBold (SIL Open Font License 1.1,
https://github.com/JetBrains/JetBrainsMono), tracked -0.025em, and
outlined to paths. The artwork looks the same everywhere and nobody needs the
font installed to use it. Do not retype it in another font, even a close one.

## Missing something?

A size or a format that is not here: https://vulnradar.dev/contact.
