# VulnRadar Coding Standards

This document defines the coding standards for the VulnRadar project to ensure consistency, maintainability, and code quality.

## General Principles

1. **Readability First** - Code is read more often than written. Prioritize clarity and maintainability.
2. **DRY (Don't Repeat Yourself)** - Consolidate duplicate logic into reusable utilities and helpers.
3. **Type Safety** - Use TypeScript strictly. Avoid `any` types; use proper interfaces and types.
4. **Error Handling** - Always handle errors gracefully with meaningful messages and proper logging.
5. **Documentation** - Use clear comments for complex logic; self-documenting code is best.

## TypeScript / JavaScript

### Naming Conventions

```typescript
// Constants: UPPER_SNAKE_CASE
const API_TIMEOUT = 5000
const MAX_RETRIES = 3

// Functions/Variables: camelCase
const getUserById = async (userId: number) => {}
let currentSession: Session

// Classes: PascalCase
class UserManager {}

// Interfaces/Types: PascalCase with descriptive names
interface UserData {}
type NotificationType = "email" | "sms"

// Private methods: _leadingUnderscore or private keyword
private _sanitizeInput() {}
```

### Function Organization

```typescript
/**
 * Clear JSDoc comments for public functions
 * @param userId - The user ID to fetch
 * @returns User data or null if not found
 */
export async function getUserById(userId: number): Promise<User | null> {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId])
    return result.rows[0] || null
  } catch (error) {
    console.error("[DB] Failed to get user:", error)
    return null
  }
}
```

### Error Handling

```typescript
// Do: Handle errors with meaningful context
try {
  await someAsyncOperation()
} catch (error) {
  console.error("[Context] Operation failed:", error)
  return ApiResponse.serverError("Failed to complete operation")
}

// Don't: Silent failures or generic errors
try {
  await someAsyncOperation()
} catch (error) {
  // Empty catch blocks hide bugs
}
```

### Database Operations

```typescript
// Do: Use CRUD utilities from lib/db-utils.ts
import { getUserById, updateUser, batchDelete } from "@/lib/db-utils"

const user = await getUserById(123)
const updated = await updateUser(userId, { name: "New Name" })

// Don't: Raw queries scattered throughout code
const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId])
```

### API Routes

```typescript
// Do: Use standardized patterns
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const { authorized, session, error } = await requireAuth()
  if (!authorized) return error

  // Logic here
  return ApiResponse.success({ data: "success" })
})

// Don't: Duplicate error handling in every route
export async function POST(req: Request) {
  try {
    // ...
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500 })
  }
}
```

## File Organization

### Route Handlers

```typescript
// /app/api/v2/resource/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getSession } from "@/lib/auth"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

// Handler
export const GET = withErrorHandling(async (request: NextRequest) => {
  // Implementation
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Implementation
})
```

### Utility Modules

```typescript
// /lib/feature-utils.ts
import pool from "@/lib/db"
import { sendEmail } from "@/lib/email"

/**
 * Core utilities for feature X
 * Grouped by logical functionality
 */

// CRUD operations
export async function createRecord() {}
export async function getRecord() {}
export async function updateRecord() {}
export async function deleteRecord() {}

// Business logic
export async function processRecord() {}
export async function validateRecord() {}
```

## Comments and Documentation

```typescript
// Bad: Obvious comments that add no value
const user = getUserData() // Get user data

// Good: Explain WHY not WHAT
// Discord tokens expire after 7 days - refresh before 6 days to avoid service disruption
const shouldRefreshDiscordToken = lastRefresh < Date.now() - 6 * 24 * 60 * 60 * 1000

// Good: Complex logic explanation
/**
 * Validates email format using RFC 5322 simplified regex
 * Note: This is lenient but catches most invalid formats
 * For strict RFC 5322 compliance, use: https://tools.ietf.org/html/rfc5322#section-3.4
 */
export function validateEmail(email: string): boolean {}
```

## API Response Format

```typescript
// Success response
{
  "data": { /* payload */ },
  "message": "Optional success message"
}

// Error response
{
  "error": "Human readable error message"
}

// Paginated response
{
  "data": [ /* items */ ],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

## Logging Standards

```typescript
// Always include context in logs
console.error("[Discord] Failed to fetch user:", error)
console.warn("[Rate Limit] User 123 exceeded quota")
console.info("[Cleanup] Deleted 45 expired sessions")

// Use [CONTEXT] prefix for debugging
console.log("[v0] Debug info during development")
```

## Performance Guidelines

1. **Database** - Use indexes for frequently queried columns; batch operations when possible
2. **Caching** - Cache API responses when safe; invalidate after updates
3. **Background Jobs** - Use `setImmediate()` for non-blocking operations
4. **Async Operations** - Always use `await` or promise chains; avoid fire-and-forget unless intentional

## Testing & Review

- Follow TypeScript strict mode
- Use absolute imports (`@/...`) not relative paths
- Ensure all external dependencies are documented
- Add JSDoc comments for public APIs
- Keep functions focused and testable (single responsibility)

## Common Patterns

### Background Email Sending
```typescript
// Send email asynchronously without blocking response
setImmediate(() => {
  sendEmail(options).catch((err) => {
    console.error("[Email] Background send failed:", err)
  })
})
```

### Graceful Error Handling
```typescript
export async function riskySomething(): Promise<Result | null> {
  try {
    return await dangerousOperation()
  } catch (error) {
    console.error("[Context] Operation failed:", error)
    return null
  }
}
```

### Batch Database Operations
```typescript
// Delete old records in bulk
const deleted = await batchDelete(
  "sessions",
  "expires_at < NOW()",
)
console.info(`[Cleanup] Deleted ${deleted} expired sessions`)
```
