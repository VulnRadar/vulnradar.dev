import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { PRODUCTS } from "@/lib/products"
import { BILLING_ENABLED } from "@/lib/constants"

/**
 * GET /api/v2/stripe/setup-products
 * 
 * Automatically creates all subscription products and prices in Stripe.
 * Run this once to set up your Stripe catalog.
 * 
 * This endpoint:
 * 1. Creates products if they don't exist
 * 2. Creates prices for each product
 * 3. Returns the created product/price IDs
 */
export async function GET() {
  if (!BILLING_ENABLED) {
    return NextResponse.json({
      success: false,
      error: "Billing is disabled in config.yaml",
    }, { status: 400 })
  }

  if (!stripe) {
    return NextResponse.json({
      success: false,
      error: "Stripe is not configured. Set STRIPE_SECRET_KEY in environment.",
    }, { status: 500 })
  }

  try {
    const results: Array<{
      productId: string
      priceId: string
      name: string
      amount: number
      interval: string
      alreadyExists: boolean
    }> = []

    for (const product of PRODUCTS) {
      // Check if product already exists by searching for metadata
      const existingProducts = await stripe.products.search({
        query: `metadata['vulnradar_id']:'${product.id}'`,
      })

      let stripeProduct
      let alreadyExists = false

      if (existingProducts.data.length > 0) {
        stripeProduct = existingProducts.data[0]
        alreadyExists = true
      } else {
        // Create the product
        stripeProduct = await stripe.products.create({
          name: product.name,
          description: product.description,
          metadata: {
            vulnradar_id: product.id,
            scans_per_day: product.scansPerDay.toString(),
          },
        })
      }

      // Check if price already exists
      const existingPrices = await stripe.prices.list({
        product: stripeProduct.id,
        active: true,
      })

      let stripePrice
      const matchingPrice = existingPrices.data.find(
        (p) => p.unit_amount === product.priceInCents && 
               p.recurring?.interval === product.interval
      )

      if (matchingPrice) {
        stripePrice = matchingPrice
      } else {
        // Create the price
        stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: product.priceInCents,
          currency: "usd",
          recurring: {
            interval: product.interval,
          },
          metadata: {
            vulnradar_id: product.id,
          },
        })
      }

      results.push({
        productId: stripeProduct.id,
        priceId: stripePrice.id,
        name: product.name,
        amount: product.priceInCents,
        interval: product.interval,
        alreadyExists,
      })
    }

    return NextResponse.json({
      success: true,
      message: "All products and prices are set up in Stripe",
      products: results,
      instructions: [
        "Products are now created in Stripe",
        "The checkout flow will use these price IDs automatically",
        "You can view them at: https://dashboard.stripe.com/products",
      ],
    })
  } catch (error) {
    console.error("[Stripe] Error setting up products:", error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}
