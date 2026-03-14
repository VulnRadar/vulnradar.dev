-- Subdomain discovery cache table
-- Stores discovered subdomains with 4-hour TTL to avoid rate limiting external APIs

CREATE TABLE IF NOT EXISTS subdomain_cache (
  domain VARCHAR(255) PRIMARY KEY,
  subdomains JSONB NOT NULL,
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for cache expiry queries
CREATE INDEX IF NOT EXISTS idx_subdomain_cache_cached_at ON subdomain_cache(cached_at);

-- Cleanup function to remove old entries (run periodically)
-- DELETE FROM subdomain_cache WHERE cached_at < NOW() - INTERVAL '24 hours';
