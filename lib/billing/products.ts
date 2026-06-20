// Backward-compatible re-export of products.ts. New code should import
// from @/lib/billing/catalog directly.
export { PRODUCTS, getPlanFromProductId, type Product } from "./catalog";
