export interface Product {
  id: string
  name: string
  description: string
  priceInCents: number
  interval: 'month' | 'year'
  scansPerDay: number
}

// Subscription products for VulnRadar
export const PRODUCTS: Product[] = [
  {
    id: 'core_supporter_monthly',
    name: 'Core Supporter',
    description: 'Support VulnRadar development + 100 scans/day',
    priceInCents: 500, // $5/month
    interval: 'month',
    scansPerDay: 100,
  },
  {
    id: 'core_supporter_yearly',
    name: 'Core Supporter (Yearly)',
    description: 'Support VulnRadar development + 100 scans/day',
    priceInCents: 4800, // $48/year (20% off)
    interval: 'year',
    scansPerDay: 100,
  },
  {
    id: 'pro_supporter_monthly',
    name: 'Pro Supporter',
    description: 'For power users - 150 scans/day',
    priceInCents: 1000, // $10/month
    interval: 'month',
    scansPerDay: 150,
  },
  {
    id: 'pro_supporter_yearly',
    name: 'Pro Supporter (Yearly)',
    description: 'For power users - 150 scans/day',
    priceInCents: 9600, // $96/year (20% off)
    interval: 'year',
    scansPerDay: 150,
  },
  {
    id: 'elite_supporter_monthly',
    name: 'Elite Supporter',
    description: 'Maximum power - 500 scans/day',
    priceInCents: 2000, // $20/month
    interval: 'month',
    scansPerDay: 500,
  },
  {
    id: 'elite_supporter_yearly',
    name: 'Elite Supporter (Yearly)',
    description: 'Maximum power - 500 scans/day',
    priceInCents: 19200, // $192/year (20% off)
    interval: 'year',
    scansPerDay: 500,
  },
]

// Map plan name to product ID prefix
export function getPlanFromProductId(productId: string): string {
  if (productId.startsWith('core_supporter')) return 'core_supporter'
  if (productId.startsWith('pro_supporter')) return 'pro_supporter'
  if (productId.startsWith('elite_supporter')) return 'elite_supporter'
  return 'free'
}
