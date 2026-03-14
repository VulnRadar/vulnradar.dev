import { useEffect, useState } from "react"

interface Version {
  app: string
  engine: string
}

let versionCache: Version | null = null

export function useVersion() {
  const [version, setVersion] = useState<Version>({ app: "loading", engine: "loading" })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Use cache if available
    if (versionCache) {
      setVersion(versionCache)
      return
    }

    // Fetch from API
    fetch("/api/config/version")
      .then((res) => res.json())
      .then((data) => {
        versionCache = data
        setVersion(data)
      })
      .catch((err) => {
        setError(err.message)
        setVersion({ app: "unknown", engine: "unknown" })
      })
  }, [])

  return { version, error }
}
