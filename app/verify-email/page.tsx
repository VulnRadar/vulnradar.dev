import React from "react"
import VerifyEmailClient from "./VerifyEmailClient"

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center">Verifying...</div>}>
      <VerifyEmailClient />
    </React.Suspense>
  )
}
