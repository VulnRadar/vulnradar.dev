// This is a helper file to map old imports to new locations
// Used for batch import replacements

export const importMappings = {
  // UI
  '@/lib/utils': '@/lib/ui/utils',
  '@/lib/animations': '@/lib/ui/animations',
  
  // Config
  '@/lib/constants': '@/lib/config/constants',
  '@/lib/client-constants': '@/lib/config/client-constants',
  '@/lib/config': '@/lib/config/config',
  '@/lib/config-values': '@/lib/config/config-values',
  '@/lib/public-paths': '@/lib/config/public-paths',
  
  // Billing
  '@/lib/billing': '@/lib/billing/billing',
  '@/lib/stripe': '@/lib/billing/stripe',
  '@/lib/stripe-webhook-setup': '@/lib/billing/stripe-webhook-setup',
  '@/lib/plans': '@/lib/billing/plans',
  '@/lib/products': '@/lib/billing/products',
  
  // Database
  '@/lib/db': '@/lib/database/db',
  '@/lib/db-utils': '@/lib/database/db-utils',
  '@/lib/cleanup': '@/lib/database/cleanup',
  
  // API
  '@/lib/api-keys': '@/lib/api/api-keys',
  '@/lib/api-utils': '@/lib/api/api-utils',
  '@/lib/api-deprecation': '@/lib/api/api-deprecation',
  '@/lib/request-utils': '@/lib/api/request-utils',
  
  // Email
  '@/lib/email': '@/lib/email/email',
  
  // Discord
  '@/lib/discord-utils': '@/lib/discord/discord-utils',
  
  // Rate Limiting
  '@/lib/rate-limit': '@/lib/rate-limiting/rate-limit',
  '@/lib/daily-limits': '@/lib/rate-limiting/daily-limits',
  
  // Notifications
  '@/lib/notifications': '@/lib/notifications/notifications',
  
  // Reports
  '@/lib/pdf-report': '@/lib/reports/pdf-report',
  
  // Features
  '@/lib/beta': '@/lib/features/beta',
}
