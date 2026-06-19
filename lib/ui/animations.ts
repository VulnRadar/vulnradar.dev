/**
 * Centralized Animation & Transition Configuration
 * ================================================
 * All animations, transitions, and motion settings are defined here.
 * Import these constants to ensure consistency across all pages.
 *
 * Usage:
 *   import { transitions, animations } from "@/lib/ui/animations"
 *   <div className={transitions.default}>...</div>
 */

// ============================================================================
// TIMING / DURATION
// ============================================================================
export const durations = {
  instant: "duration-75", // 75ms - micro-interactions
  fast: "duration-150", // 150ms - buttons, toggles
  default: "duration-200", // 200ms - standard transitions
  normal: "duration-300", // 300ms - modals, dropdowns
  slow: "duration-500", // 500ms - page transitions
  slower: "duration-700", // 700ms - emphasis animations
} as const;

// ============================================================================
// EASING FUNCTIONS
// ============================================================================
export const easings = {
  default: "ease-out",
  smooth: "ease-in-out",
  bounce: "ease-[cubic-bezier(0.34,1.56,0.64,1)]",
  spring: "ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
} as const;

// ============================================================================
// STANDARD TRANSITIONS (combine duration + easing)
// ============================================================================
export const transitions = {
  // Basic transitions
  none: "",
  instant: "transition-all duration-75 ease-out",
  fast: "transition-all duration-150 ease-out",
  default: "transition-all duration-200 ease-out",
  normal: "transition-all duration-300 ease-out",
  slow: "transition-all duration-500 ease-out",

  // Specific property transitions
  colors: "transition-colors duration-200 ease-out",
  opacity: "transition-opacity duration-200 ease-out",
  transform: "transition-transform duration-200 ease-out",
  shadow: "transition-shadow duration-200 ease-out",

  // Combined common patterns
  interactive: "transition-all duration-150 ease-out", // buttons, links
  hover: "transition-all duration-200 ease-out", // hover states
  modal: "transition-all duration-300 ease-out", // modals, sheets
  page: "transition-all duration-500 ease-out", // page transitions
} as const;

// ============================================================================
// HOVER EFFECTS
// ============================================================================
export const hovers = {
  // Opacity
  opacity: "hover:opacity-80",
  opacitySubtle: "hover:opacity-90",

  // Scale
  scale: "hover:scale-105",
  scaleSubtle: "hover:scale-[1.02]",
  scaleSm: "hover:scale-[1.01]",

  // Lift (translate + shadow)
  lift: "hover:-translate-y-0.5 hover:shadow-lg",
  liftSubtle: "hover:-translate-y-px hover:shadow-md",

  // Background
  bg: "hover:bg-muted",
  bgSubtle: "hover:bg-muted/50",
  bgAccent: "hover:bg-accent",

  // Border
  border: "hover:border-primary",
  borderSubtle: "hover:border-foreground/20",

  // Combined patterns
  card: "hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5",
  cardSubtle: "hover:shadow-md hover:border-foreground/20",
  button: "hover:opacity-90 active:scale-[0.98]",
  link: "hover:text-primary hover:underline underline-offset-4",
  nav: "hover:text-foreground hover:bg-muted/50",
} as const;

// ============================================================================
// FOCUS STATES
// ============================================================================
export const focus = {
  ring: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  within:
    "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
  none: "focus:outline-none focus-visible:outline-none",
} as const;

// ============================================================================
// ANIMATION CLASSES (for keyframe animations)
// ============================================================================
export const animations = {
  // Fade
  fadeIn: "animate-fade-in",
  fadeOut: "animate-fade-out",

  // Slide
  slideUp: "animate-slide-up",
  slideDown: "animate-slide-down",
  slideLeft: "animate-slide-left",
  slideRight: "animate-slide-right",

  // Scale
  scaleIn: "animate-scale-in",
  scaleOut: "animate-scale-out",

  // Special
  pulse: "animate-pulse",
  spin: "animate-spin",
  bounce: "animate-bounce",
  ping: "animate-ping",

  // Custom
  shimmer: "animate-shimmer",
  glow: "animate-glow",
  float: "animate-float",
} as const;

// ============================================================================
// COMBINED INTERACTIVE STATES
// ============================================================================
export const interactive = {
  // Buttons
  button: `${transitions.fast} ${hovers.button} ${focus.ring}`,
  buttonGhost: `${transitions.fast} hover:bg-muted active:bg-muted/80 ${focus.ring}`,
  buttonOutline: `${transitions.fast} hover:bg-accent hover:text-accent-foreground active:scale-[0.98] ${focus.ring}`,

  // Cards
  card: `${transitions.default} ${hovers.cardSubtle} ${focus.ring}`,
  cardInteractive: `${transitions.default} ${hovers.card} cursor-pointer ${focus.ring}`,

  // Links
  link: `${transitions.colors} ${hovers.link}`,
  navLink: `${transitions.colors} ${hovers.nav}`,

  // Inputs
  input: `${transitions.colors} ${focus.ring}`,
} as const;

// ============================================================================
// BACKDROP / OVERLAY
// ============================================================================
export const backdrops = {
  modal: "bg-black/80 backdrop-blur-md",
  modalSubtle: "bg-black/60 backdrop-blur-sm",
  sheet: "bg-black/50 backdrop-blur-sm",
  header:
    "bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60",
  card: "bg-card/95 backdrop-blur-sm",
} as const;

// ============================================================================
// GLOW / GRADIENT EFFECTS
// ============================================================================
export const effects = {
  // Glows
  glow: "shadow-[0_0_20px_-5px_hsl(var(--primary)/0.3)]",
  glowSm: "shadow-[0_0_10px_-3px_hsl(var(--primary)/0.2)]",
  glowLg: "shadow-[0_0_40px_-10px_hsl(var(--primary)/0.4)]",

  // Glass
  glass: "backdrop-blur-md bg-card/80 border border-border/50",
  glassDark: "backdrop-blur-md bg-background/80 border border-border/50",

  // Gradient text
  gradientText:
    "bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70",

  // Orb (for hero sections)
  orb: "absolute rounded-full blur-3xl opacity-20 pointer-events-none",
  orbPrimary: "bg-primary",
  orbSecondary: "bg-blue-500",
} as const;

// ============================================================================
// STAGGER DELAYS (for list animations)
// ============================================================================
export const stagger = {
  none: "",
  delay1: "animation-delay-[100ms]",
  delay2: "animation-delay-[200ms]",
  delay3: "animation-delay-[300ms]",
  delay4: "animation-delay-[400ms]",
  delay5: "animation-delay-[500ms]",
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Combine multiple animation/transition classes
 */
export function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Get stagger delay class for list items
 */
export function getStaggerDelay(index: number, baseDelay = 50): string {
  const delay = index * baseDelay;
  return `[animation-delay:${delay}ms]`;
}
