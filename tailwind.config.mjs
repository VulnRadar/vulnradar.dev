import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Tailwind theme config, bridged into the v4 CSS-first pipeline via
 * `@config '../tailwind.config.mjs'` in app/globals.css. Authored as .mjs
 * (unambiguously ESM) rather than .ts so Node does not emit a
 * MODULE_TYPELESS_PACKAGE_JSON warning when @tailwindcss/postcss loads it at
 * build time; the JSDoc @type below keeps editor autocomplete without the TS
 * syntax that triggered the warning.
 *
 * @type {import('tailwindcss').Config}
 */
const config = {
  darkMode: "class",
  // NOTE: `lib/` is NOT here, and that is a real trap rather than an
  // oversight nobody has noticed. Several modules under lib/ hold Tailwind
  // class strings that only ever appear there -- lib/config/client-constants
  // .ts's ROLE_BADGE_STYLES is the worst of them -- and a class that appears
  // nowhere in a scanned file generates no CSS, with no build error and no
  // warning. Three staff badges shipped with no colour at all this way.
  //
  // The safelist lives in the `@source inline(...)` block at the top of
  // app/globals.css, so a class string added under lib/ has to be added
  // there too. Widening this array to include "./lib/**/*.{ts,tsx}" would
  // remove the need for that half of the safelist, but it also puts the
  // whole scanner tree (thousands of lines of check descriptions and
  // remediation prose) through Tailwind's candidate extractor, so it is a
  // change to make deliberately and measure, not a one-line tidy-up.
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        // No `sidebar` group here. It used to declare eight utilities
        // (bg-sidebar, text-sidebar-foreground and siblings) resolving to
        // --sidebar-background and friends, and not one of those CSS
        // variables was defined in app/globals.css or anywhere else. So the
        // utilities existed, IntelliSense offered them, and each compiled to
        // hsl() with an empty argument, which is an invalid colour the
        // browser drops: a transparent element with no error anywhere. The
        // product's two sidebars (/profile and /admin) both hand-rolled
        // bg-primary/10 instead. If a real sidebar palette is wanted, define
        // the variables in :root and .dark in the same change that adds the
        // group back, never one without the other.
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-left": {
          from: { opacity: "0", transform: "translateX(10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-right": {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "scale-out": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.95)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        glow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "fade-out": "fade-out 0.3s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        "slide-down": "slide-down 0.3s ease-out",
        "slide-left": "slide-left 0.3s ease-out",
        "slide-right": "slide-right 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "scale-out": "scale-out 0.2s ease-out",
        shimmer: "shimmer 2s linear infinite",
        glow: "glow 2s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
