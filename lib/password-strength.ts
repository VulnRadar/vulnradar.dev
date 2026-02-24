/**
 * Advanced Password Strength Analyzer
 * 
 * Features:
 * - Multi-level strength assessment with detailed feedback
 * - Detection of common patterns, sequences, and weak structures
 * - Dictionary-based common password detection
 * - Entropy calculation for scientific strength measurement
 * - Comprehensive vulnerability reporting
 * - User-friendly recommendations for improvement
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PasswordFeedback {
  suggestions: string[]
  warnings: string[]
}

export interface EntropyMetrics {
  bits: number
  guessesPerSecond: number
  crackTimeSeconds: number
  crackTimeEstimate: string
}

export interface PasswordAnalysis {
  strength: PasswordStrength
  entropy: EntropyMetrics
  feedback: PasswordFeedback
  score: number
  hasLowercase: boolean
  hasUppercase: boolean
  hasNumbers: boolean
  hasSpecialChars: boolean
  length: number
  characterSpace: number
}

export interface PasswordStrength {
  level: 0 | 1 | 2 | 3 | 4
  label: "Too Weak" | "Weak" | "Fair" | "Strong" | "Very Strong"
  color: string
  percentage: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Top ~250 most common passwords across data breaches
const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "qwerty", "abc123", "monkey", "1234567",
  "letmein", "trustno1", "dragon", "baseball", "iloveyou", "master", "sunshine",
  "ashley", "bailey", "shadow", "123123", "654321", "superman", "qazwsx",
  "michael", "football", "password1", "password123", "welcome", "welcome1",
  "p@ssword", "p@ssw0rd", "passw0rd", "admin", "admin123", "root", "toor",
  "login", "access", "hello", "charlie", "donald", "qwerty123", "lovely",
  "7777777", "888888", "princess", "dragon", "password1!", "changeme",
  "test123", "guest", "default", "letmein1", "1234567890", "123456789",
  "1234", "12345", "11111", "00000", "121212", "qwertyuiop", "asdfghjkl",
  "zxcvbnm", "1q2w3e4r", "1qaz2wsx", "abcdef", "abcdefg", "abcdefgh",
  "secret", "password2", "password12", "starwars", "whatever", "computer",
  "jessica", "pepper", "ginger", "killer", "summer", "internet", "service",
  "canada", "hello1", "freedom", "thunder", "jordan", "samsung", "google",
  "pokemon", "hunter", "ranger", "buster", "soccer", "hockey", "george",
  "andrew", "harley", "matrix", "yankees", "dallas", "austin", "banana",
  "jennifer", "andrea", "joshua", "daniel", "robert", "thomas", "batman",
  "corvette", "merlin", "silver", "hammer", "orange", "purple", "turbo",
  "sparky", "fluffy", "soccer", "hockey", "guitar", "tennis", "coffee",
  "cheese", "dragon1", "master1", "shadow1", "123456!", "qwerty1", "pass",
  "pass123", "admin1", "root1", "user", "username", "password!", "pass!",
  "welcome123", "test", "test1", "demo", "demo123", "temp", "temp123",
]);

// Common keyboard patterns (QWERTY, etc.)
const KEYBOARD_PATTERNS = [
  "qwerty", "asdfgh", "zxcvbn", "qazwsx", "qwertyuiop", "asdfghjkl", "zxcvbnm",
  "1qaz2wsx", "2wsx3edc", "3edc4rfv", "qweasd", "qwe", "asd", "zxc",
];

// Common name patterns and sequences
const COMMON_SEQUENCES = [
  "abc", "bcd", "cde", "def", "efg", "fgh", "ghi", "hij", "ijk", "jkl",
  "klm", "lmn", "mno", "nop", "opq", "pqr", "qrs", "rst", "stu", "tuv",
  "uvw", "vwx", "wxy", "xyz", "012", "123", "234", "345", "456", "567",
  "678", "789", "890",
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if password contains sequential characters (abc, 123, cba, 321)
 */
function hasSequentialChars(pw: string): number {
  const lower = pw.toLowerCase()
  let count = 0

  for (let i = 0; i < lower.length - 2; i++) {
    const a = lower.charCodeAt(i)
    const b = lower.charCodeAt(i + 1)
    const c = lower.charCodeAt(i + 2)

    // Ascending: abc, 123
    if (b === a + 1 && c === a + 2) count++
    // Descending: cba, 321
    if (b === a - 1 && c === a - 2) count++
  }

  return count
}

/**
 * Check if password contains repeated characters (aaa, 111)
 */
function hasRepeatedChars(pw: string): number {
  let count = 0

  for (let i = 0; i < pw.length - 2; i++) {
    if (pw[i] === pw[i + 1] && pw[i] === pw[i + 2]) {
      count++
    }
  }

  return count
}

/**
 * Check if password contains common keyboard patterns
 */
function hasKeyboardPattern(pw: string): boolean {
  const lower = pw.toLowerCase()
  return KEYBOARD_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Check if password is a common dictionary word (simplified check)
 */
function isCommonWord(word: string): boolean {
  return COMMON_PASSWORDS.has(word.toLowerCase())
}

/**
 * Count consecutive similar characters (for penalty calculation)
 */
function countConsecutiveChars(pw: string): number {
  let count = 0
  const seen = new Set<string>()

  for (let i = 0; i < pw.length - 1; i++) {
    const pair = pw[i] + pw[i + 1]
    if (pw[i] === pw[i + 1] && !seen.has(pair)) {
      count++
      seen.add(pair)
    }
  }

  return count
}

/**
 * Calculate password entropy (information-theoretic strength)
 */
function calculateEntropy(pw: string): number {
  let charSpace = 0

  if (/[a-z]/.test(pw)) charSpace += 26
  if (/[A-Z]/.test(pw)) charSpace += 26
  if (/\d/.test(pw)) charSpace += 10
  if (/[^a-zA-Z0-9]/.test(pw)) charSpace += 32

  const entropy = pw.length * Math.log2(charSpace)
  return isFinite(entropy) ? entropy : 0
}

/**
 * Estimate crack time in seconds (assumes 10^10 guesses/sec)
 */
function estimateCrackTime(entropyBits: number): number {
  const GUESSES_PER_SECOND = 1e10
  const totalGuesses = Math.pow(2, entropyBits) / 2 // Average case
  return totalGuesses / GUESSES_PER_SECOND
}

/**
 * Convert seconds to human-readable format
 */
function formatCrackTime(seconds: number): string {
  if (seconds < 1) return "less than 1 second"
  if (seconds < 60) return `${Math.round(seconds)} seconds`
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`
  if (seconds < 2592000) return `${Math.round(seconds / 86400)} days`
  if (seconds < 31536000) return `${Math.round(seconds / 2592000)} months`
  return `${Math.round(seconds / 31536000)} years`
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Comprehensive password strength analysis
 *
 * Scoring breakdown (0-10 scale):
 *   +1 for length >= 8
 *   +1 for length >= 12
 *   +1 for length >= 16
 *   +1 for length >= 20
 *   +1 for lowercase letters
 *   +1 for uppercase letters
 *   +1 for numbers
 *   +1 for special characters
 *   +1 for mixed character classes (min 3 different types)
 *   +1 for length >= 14 (extended security)
 *
 * Penalties:
 *   -3 if common password (dictionary match)
 *   -2 if keyboard pattern detected
 *   -1 for each sequential character sequence
 *   -1 for each repeated character sequence (aaa, 111)
 *   -0.5 for each consecutive duplicate character pair
 */
export function analyzePassword(pw: string): PasswordAnalysis {
  // Edge case: empty password
  if (!pw) {
    return {
      strength: {
        level: 0,
        label: "Too Weak",
        color: "bg-red-600",
        percentage: 0,
      },
      entropy: {
        bits: 0,
        guessesPerSecond: 0,
        crackTimeSeconds: 0,
        crackTimeEstimate: "instantly",
      },
      feedback: {
        suggestions: ["Password cannot be empty"],
        warnings: [],
      },
      score: 0,
      hasLowercase: false,
      hasUppercase: false,
      hasNumbers: false,
      hasSpecialChars: false,
      length: 0,
      characterSpace: 0,
    }
  }

  let score = 0

  // Character type checks
  const hasLowercase = /[a-z]/.test(pw)
  const hasUppercase = /[A-Z]/.test(pw)
  const hasNumbers = /\d/.test(pw)
  const hasSpecialChars = /[^a-zA-Z0-9]/.test(pw)

  // Length-based scoring
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (pw.length >= 16) score += 1
  if (pw.length >= 20) score += 1

  // Character class scoring
  if (hasLowercase) score += 1
  if (hasUppercase) score += 1
  if (hasNumbers) score += 1
  if (hasSpecialChars) score += 1

  // Mixed character class bonus (at least 3 different types)
  const charTypesCount = [hasLowercase, hasUppercase, hasNumbers, hasSpecialChars].filter(Boolean).length
  if (charTypesCount >= 3) score += 1

  // Extended security bonus
  if (pw.length >= 14) score += 1

  // Penalty: Common password
  if (isCommonWord(pw)) score -= 3

  // Penalty: Keyboard patterns
  if (hasKeyboardPattern(pw)) score -= 2

  // Penalty: Sequential characters
  const sequentialCount = hasSequentialChars(pw)
  score -= sequentialCount

  // Penalty: Repeated characters
  const repeatedCount = hasRepeatedChars(pw)
  score -= repeatedCount

  // Penalty: Consecutive duplicates
  const consecutiveDupes = countConsecutiveChars(pw)
  score -= consecutiveDupes * 0.5

  // Clamp score between 0 and 10
  score = Math.max(0, Math.min(10, score))

  // Determine strength level
  let strength: PasswordStrength
  if (score < 2) {
    strength = {
      level: 0,
      label: "Too Weak",
      color: "bg-red-600",
      percentage: Math.round((score / 10) * 100),
    }
  } else if (score < 4) {
    strength = {
      level: 1,
      label: "Weak",
      color: "bg-red-500",
      percentage: Math.round((score / 10) * 100),
    }
  } else if (score < 6) {
    strength = {
      level: 2,
      label: "Fair",
      color: "bg-yellow-500",
      percentage: Math.round((score / 10) * 100),
    }
  } else if (score < 8) {
    strength = {
      level: 3,
      label: "Strong",
      color: "bg-blue-500",
      percentage: Math.round((score / 10) * 100),
    }
  } else {
    strength = {
      level: 4,
      label: "Very Strong",
      color: "bg-green-600",
      percentage: Math.round((score / 10) * 100),
    }
  }

  // Calculate entropy
  const entropy = calculateEntropy(pw)
  const crackTime = estimateCrackTime(entropy)

  // Generate character space value
  let charSpace = 0
  if (hasLowercase) charSpace += 26
  if (hasUppercase) charSpace += 26
  if (hasNumbers) charSpace += 10
  if (hasSpecialChars) charSpace += 32

  // Generate feedback and suggestions
  const suggestions: string[] = []
  const warnings: string[] = []

  if (pw.length < 12) {
    suggestions.push("Use at least 12 characters for better security")
  }
  if (!hasUppercase && !hasLowercase) {
    suggestions.push("Mix uppercase and lowercase letters")
  }
  if (!hasNumbers) {
    suggestions.push("Add numbers to strengthen the password")
  }
  if (!hasSpecialChars) {
    suggestions.push("Include special characters (!@#$%^&*) for maximum strength")
  }
  if (charTypesCount < 3) {
    suggestions.push(`Use at least 3 different character types (you have ${charTypesCount})`)
  }

  if (isCommonWord(pw)) {
    warnings.push("This is a commonly used password - avoid it")
  }
  if (hasKeyboardPattern(pw)) {
    warnings.push("Contains keyboard patterns (qwerty, asdfgh, etc.)")
  }
  if (sequentialCount > 0) {
    warnings.push(`Contains ${sequentialCount} sequential character sequence(s) (abc, 123)`)
  }
  if (repeatedCount > 0) {
    warnings.push(`Contains ${repeatedCount} repeated character sequence(s) (aaa, 111)`)
  }

  return {
    strength,
    entropy: {
      bits: Math.round(entropy * 100) / 100,
      guessesPerSecond: 1e10,
      crackTimeSeconds: crackTime,
      crackTimeEstimate: formatCrackTime(crackTime),
    },
    feedback: {
      suggestions,
      warnings,
    },
    score: Math.round(score * 100) / 100,
    hasLowercase,
    hasUppercase,
    hasNumbers,
    hasSpecialChars,
    length: pw.length,
    characterSpace: charSpace,
  }
}

/**
 * Legacy function for backward compatibility
 */
export function getPasswordStrength(pw: string): PasswordStrength {
  const analysis = analyzePassword(pw)
  return analysis.strength
}

/**
 * Generate a strong password suggestion
 */
export function generateStrongPassword(length: number = 16): string {
  const lowercase = "abcdefghijklmnopqrstuvwxyz"
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const numbers = "0123456789"
  const special = "!@#$%^&*-_=+"

  const all = lowercase + uppercase + numbers + special
  let password = ""

  // Ensure at least one of each type
  password += lowercase[Math.floor(Math.random() * lowercase.length)]
  password += uppercase[Math.floor(Math.random() * uppercase.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += special[Math.floor(Math.random() * special.length)]

  // Fill remaining length
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)]
  }

  // Shuffle
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("")
}