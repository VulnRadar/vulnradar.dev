# Import Organization Standards

This document outlines the standard import organization pattern for the VulnRadar codebase to ensure consistency and maintainability.

## Import Order

Imports should be organized in the following order with blank lines separating each group:

1. **Node.js & Third-party Libraries** - `import ... from "package-name"`
2. **Next.js Modules** - `import ... from "next/..."`
3. **Project Utilities** - `import ... from "@/lib/..."`
4. **Project Components** - `import ... from "@/components/..."`
5. **Type Definitions & Interfaces** - `interface ..., type ...`
6. **Constants** - `const ...`

### Example Pattern

```typescript
// Node.js & Third-party
import nodemailer from "nodemailer"
import crypto from "crypto"

// Next.js
import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

// Project Utilities
import { getSession, createSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { getUserTwoFAConfig, sendDiscordEmail2FACode } from "@/lib/discord-utils"
import { ERROR_MESSAGES } from "@/lib/constants"

// Project Components
import { UserCard } from "@/components/user-card"

// Types & Interfaces
interface UserData {
  id: number
  email: string
}

// Constants
const ADMIN_ROLE = "admin"
```

## Rules

- **Remove unused imports** - Use ESLint or IDE tools to identify and remove imports that aren't used
- **Group related imports** - Keep similar utilities together (e.g., all auth imports, all database imports)
- **Use destructuring** - Prefer `import { func1, func2 }` over multiple individual imports
- **Absolute imports only** - Always use `@/` prefix for project imports, never relative paths
- **One blank line between groups** - Improves readability and visual separation
- **Alphabetically sort within groups** - Sort multi-line destructured imports alphabetically

## Common Patterns

### API Routes
```typescript
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  // ...
})
```

### Page Components
```typescript
import { ReactNode } from "react"
import { Metadata } from "next"

import { SomeComponent } from "@/components/some-component"
import { getPageData } from "@/lib/data"

export const metadata: Metadata = { /* ... */ }

export default async function Page(): Promise<ReactNode> {
  // ...
}
```

### Utilities
```typescript
import pool from "@/lib/db"
import { ApiResponse } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function someUtility(): Promise<void> {
  // ...
}
```
