export interface Product {
  id: string
  name: string
  description: string
  priceInCents: number
  interval: "month" | "year"
  scansPerDay: number
}

// Subscription products for VulnRadar
export const PRODUCTS: Product[] = [
  {
    id: "core_supporter_monthly",
    name: "Core Supporter",
    description: "100 scans/day, 90-day history, email support, early access features",
    priceInCents: 500, // $5/month
    interval: "month",
    scansPerDay: 100,
  },
  {
    id: "core_supporter_yearly",
    name: "Core Supporter (Yearly)",
    description: "100 scans/day, 90-day history, email support, early access features",
    priceInCents: 4800, // $48/year (20% off)
    interval: "year",
    scansPerDay: 100,
  },
  {
    id: "pro_supporter_monthly",
    name: "Pro Supporter",
    description: "150 scans/day, unlimited history, priority support, early access features",
    priceInCents: 1000, // $10/month
    interval: "month",
    scansPerDay: 150,
  },
  {
    id: "pro_supporter_yearly",
    name: "Pro Supporter (Yearly)",
    description: "150 scans/day, unlimited history, priority support, early access features",
    priceInCents: 9600, // $96/year (20% off)
    interval: "year",
    scansPerDay: 150,
  },
  {
    id: "elite_supporter_monthly",
    name: "Elite Supporter",
    description: "500 scans/day, unlimited everything, dedicated support, beta features",
    priceInCents: 2000, // $20/month
    interval: "month",
    scansPerDay: 500,
  },
  {
    id: "elite_supporter_yearly",
    name: "Elite Supporter (Yearly)",
    description: "500 scans/day, unlimited everything, dedicated support, beta features",
    priceInCents: 19200, // $192/year (20% off)
    interval: "year",
    scansPerDay: 500,
  },
]

export function getProduct(productId: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === productId)
}
