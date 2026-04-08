#!/usr/bin/env node
/**
 * Generate config.generated.ts from config.yaml
 * 
 * Run this script after editing config.yaml to regenerate the TypeScript config file.
 * The generated file can be imported anywhere (Edge, browser, server) with no fs dependencies.
 * 
 * Usage: node scripts/generate-config.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// Simple YAML parser for nested structures
function parseYaml(content) {
  const result = {}
  const lines = content.split('\n')
  const stack = [{ indent: -1, obj: result }]
  
  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue
    
    // Calculate indentation
    const indent = line.search(/\S/)
    if (indent === -1) continue
    
    const trimmed = line.trim()
    
    // Parse key: value
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue
    
    const key = trimmed.substring(0, colonIndex).trim()
    let value = trimmed.substring(colonIndex + 1).trim()
    
    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }
    
    const parent = stack[stack.length - 1].obj
    
    if (value === '' || value === '|' || value === '>') {
      // This is a nested object
      parent[key] = {}
      stack.push({ indent, obj: parent[key] })
    } else {
      // Remove quotes and parse value
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      
      // Parse numbers and booleans
      if (value === 'true') value = true
      else if (value === 'false') value = false
      else if (/^-?\d+$/.test(value)) value = parseInt(value, 10)
      else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value)
      
      parent[key] = value
    }
  }
  
  return result
}

function generateConfig() {
  const configPath = path.join(ROOT, 'config.yaml')
  
  if (!fs.existsSync(configPath)) {
    console.error('Error: config.yaml not found at', configPath)
    process.exit(1)
  }
  
  const content = fs.readFileSync(configPath, 'utf-8')
  const config = parseYaml(content)
  
  console.log('Parsed config.yaml:')
  console.log('  app.name:', config.app?.name)
  console.log('  app.url:', config.app?.url)
  console.log('  branding.logo_url:', config.branding?.logo_url)
  
  // Generate TypeScript file
  const output = `// ============================================================================
// AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
// ============================================================================
// Generated from config.yaml by scripts/generate-config.mjs
// Run \`node scripts/generate-config.mjs\` to regenerate after editing config.yaml
// ============================================================================

// App metadata
export const APP_NAME = ${JSON.stringify(config.app?.name || 'VulnRadar')}
export const APP_SLUG = ${JSON.stringify(config.app?.slug || 'vulnradar')}
export const APP_VERSION = ${JSON.stringify(config.app?.version || '0.0.0')}
export const ENGINE_VERSION = ${JSON.stringify(config.app?.engine_version || '0.0.0')}
export const API_VERSION = ${JSON.stringify(config.app?.api_version || 'v1')}
export const APP_DESCRIPTION = ${JSON.stringify(config.app?.description || '')}
export const TOTAL_CHECKS_LABEL = ${JSON.stringify(config.app?.total_checks_label || '')}
export const APP_URL = ${JSON.stringify(config.app?.url || 'http://localhost:3000')}
export const APP_REPO = ${JSON.stringify(config.app?.repo || '')}
export const DISCORD_INVITE_URL = ${JSON.stringify(config.app?.discord_invite_url || '')}
export const TERMS_UPDATED_AT = ${JSON.stringify(config.app?.terms_updated_at || '')}

// Contact emails
export const SUPPORT_EMAIL = ${JSON.stringify(config.app?.support_email || '')}
export const LEGAL_EMAIL = ${JSON.stringify(config.app?.legal_email || '')}
export const SECURITY_EMAIL = ${JSON.stringify(config.app?.security_email || '')}
export const ENTERPRISE_EMAIL = ${JSON.stringify(config.app?.enterprise_email || '')}
export const NOREPLY_EMAIL = ${JSON.stringify(config.app?.noreply_email || '')}

// Branding
export const BRANDING = {
  logo_url: ${JSON.stringify(config.branding?.logo_url || '/logo.svg')},
  primary_color: ${JSON.stringify(config.branding?.primary_color || '#6366f1')},
  footer_text: ${JSON.stringify(config.branding?.footer_text || '')},
}

// Cookies
export const COOKIES = {
  session: {
    name: ${JSON.stringify(config.cookies?.session?.name || 'session')},
    max_age_days: ${config.cookies?.session?.max_age_days || 7},
  },
  version: {
    name: ${JSON.stringify(config.cookies?.version?.name || 'last_seen_version')},
    max_age_days: ${config.cookies?.version?.max_age_days || 365},
  },
  device_trust: {
    name: ${JSON.stringify(config.cookies?.device_trust?.name || 'device_trusted')},
    max_age_days: ${config.cookies?.device_trust?.max_age_days || 30},
  },
  two_fa_pending: {
    name: ${JSON.stringify(config.cookies?.two_fa_pending?.name || '2fa_pending')},
    max_age_seconds: ${config.cookies?.two_fa_pending?.max_age_seconds || 300},
  },
}

// Auth timeouts
export const AUTH = {
  session_timeout_days: ${config.auth?.session_timeout_days || 7},
  password_reset_hours: ${config.auth?.password_reset_hours || 1},
  email_verification_hours: ${config.auth?.email_verification_hours || 24},
  device_trust_days: ${config.auth?.device_trust_days || 30},
}

// Rate limits
export const RATE_LIMITS = {
  login: {
    max_attempts: ${config.rate_limits?.login?.max_attempts || 5},
    window_minutes: ${config.rate_limits?.login?.window_minutes || 15},
  },
  signup: {
    max_attempts: ${config.rate_limits?.signup?.max_attempts || 3},
    window_minutes: ${config.rate_limits?.signup?.window_minutes || 60},
  },
  api: {
    window_minutes: ${config.rate_limits?.api?.window_minutes || 1},
  },
}

// Scanning
export const SCANNING = {
  max_concurrent: ${config.scanning?.max_concurrent || 3},
  timeout_seconds: ${config.scanning?.timeout_seconds || 60},
  max_retries: ${config.scanning?.max_retries || 2},
}

// Billing
export const BILLING = {
  enabled: ${config.billing?.enabled ?? false},
}
`

  const outputPath = path.join(ROOT, 'lib/config/config.generated.ts')
  fs.writeFileSync(outputPath, output, 'utf-8')
  
  console.log('\nGenerated:', outputPath)
  console.log('Config values are now available for import in all environments!')
}

generateConfig()
