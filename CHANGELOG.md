# Changelog

All notable changes to VulnRadar are documented in this file.

## [1.9.4-patch.1] - 2026-02-27

### Added
- **API Key Encryption Support**: Added support for optional AES-256-GCM encryption of API keys when `API_KEY_ENCRYPTION_KEY` environment variable is configured
- **Dual-method API Key Validation**: API key validation now intelligently supports both encrypted and hashed keys, allowing seamless transitions between encryption methods

### Changed
- **API Key Generation**: `generateApiKey()` now conditionally stores keys as encrypted or hashed based on environment configuration
  - When `API_KEY_ENCRYPTION_KEY` is set: Keys are encrypted and stored with `deprecated_` placeholder in `key_hash`
  - When not set: Keys are hashed and stored as before (backward compatible)
- **API Key Validation**: `validateApiKey()` enhanced with fallback logic
  - Attempts encrypted lookup first if encryption is configured
  - Falls back to hash-based comparison for legacy and unencrypted keys
  - Ensures all API endpoints automatically support both methods

### Security
- Encrypted API keys now use AES-256-GCM encryption when enabled
- Backward compatible with existing hash-based keys

### Compatibility
- ✅ Fully backward compatible with existing deployments
- ✅ No database schema changes required
- ✅ No API endpoint changes needed
- ✅ All existing API keys continue to work

## [1.9.4] - Previous Release

See git history for details on earlier versions.
