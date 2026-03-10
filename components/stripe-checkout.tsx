'use client'

import { useCallback, useState } from 'react'
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants'

import { startCheckoutSession } from '@/app/actions/stripe'
import { getPlanFromProductId } from '@/lib/products'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export function StripeCheckout({ productId, userEmail, userId, onSuccess }: { 
  productId: string
  userEmail?: string
  userId?: number
  onSuccess?: () => void 
}) {
  const [checkoutComplete, setCheckoutComplete] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const expectedPlan = getPlanFromProductId(productId)

  const fetchClientSecret = useCallback(async () => {
    const clientSecret = await startCheckoutSession(productId, userEmail, userId)
    return clientSecret!
  }, [productId, userEmail, userId])

  // Poll /api/v2/auth/me to verify subscription update
  const verifySubscription = useCallback(async () => {
    setVerifying(true)
    setError(null)
    
    // Poll up to 10 times with 2 second intervals (20 seconds total)
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch('/api/v2/auth/me')
        if (response.ok) {
          const data = await response.json()
          const currentPlan = data.data?.plan || 'free'
          
          // Check if user has the expected plan
          if (currentPlan === expectedPlan) {
            setVerified(true)
            setVerifying(false)
            onSuccess?.()
            return
          }
        }
      } catch (err) {
        console.error('[v0] Error verifying subscription:', err)
      }
      
      // Wait 2 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    // Verification timed out
    setVerifying(false)
    setError('Subscription update is taking longer than expected. Please refresh the page.')
  }, [expectedPlan, onSuccess])

  // Handle checkout complete callback from Stripe
  const handleComplete = useCallback(() => {
    setCheckoutComplete(true)
    verifySubscription()
  }, [verifySubscription])

  // Show success state
  if (verified) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6">
          <Check className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Subscription Active!</h3>
        <p className="text-muted-foreground mb-6">
          Your plan has been upgraded to <span className="font-medium text-foreground">{expectedPlan.replace('_', ' ').replace(/(^\w|\s\w)/g, m => m.toUpperCase())}</span>
        </p>
        <Button asChild>
          <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
        </Button>
      </div>
    )
  }

  // Show verifying state
  if (checkoutComplete && verifying) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <h3 className="text-lg font-semibold mb-2">Activating your subscription...</h3>
        <p className="text-sm text-muted-foreground">This will only take a moment</p>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>Refresh Page</Button>
      </div>
    )
  }

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ 
          fetchClientSecret,
          onComplete: handleComplete,
        }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}
