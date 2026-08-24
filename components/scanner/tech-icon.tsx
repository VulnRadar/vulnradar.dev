import type { IconType } from "react-icons";
import { GrHeroku } from "react-icons/gr";
import { FaMagento } from "react-icons/fa";
import {
  SiCloudflare,
  SiFastly,
  SiNextdotjs,
  SiNuxt,
  SiReact,
  SiVuedotjs,
  SiAngular,
  SiSvelte,
  SiAstro,
  SiRemix,
  SiGatsby,
  SiPreact,
  SiSolid,
  SiQwik,
  SiEmberdotjs,
  SiAlpinedotjs,
  SiHtmx,
  SiTailwindcss,
  SiBootstrap,
  SiJquery,
  SiStripe,
  SiGoogleanalytics,
  SiGoogletagmanager,
  SiVercel,
  SiNetlify,
  SiFlydotio,
  SiRender,
  SiGithub,
  SiLaravel,
  SiDjango,
  SiExpress,
  SiPhp,
  SiPython,
  SiNginx,
  SiApache,
  SiApachetomcat,
  SiCaddy,
  SiGunicorn,
  SiWordpress,
  SiDrupal,
  SiJoomla,
  SiShopify,
  SiGhost,
  SiHugo,
  SiJekyll,
  SiDocusaurus,
  SiWebflow,
  SiHubspot,
  SiPrestashop,
  SiDotnet,
} from "react-icons/si";
import { Boxes } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * Real brand icons for detected technologies in the software inventory
 * (lib/scanner/software-inventory.ts). Keys are the exact canonical names that
 * module produces. `color` is a brand color chosen to read on BOTH the light
 * and dark panel backgrounds; brands whose real color is near-black (Next.js,
 * Vercel, GitHub, ...) omit it and inherit the surrounding text color instead,
 * so they never vanish in dark mode. Anything not in this map falls back to a
 * neutral generic icon -- exhaustive per-brand coverage is Wappalyzer's domain.
 */
interface Brand {
  Icon: IconType;
  /** Omitted => inherit currentColor (for near-black brand marks). */
  color?: string;
}

const BRANDS: Record<string, Brand> = {
  // Hosting / CDN
  Cloudflare: { Icon: SiCloudflare, color: "#F38020" },
  Fastly: { Icon: SiFastly, color: "#FF282D" },
  Vercel: { Icon: SiVercel },
  Netlify: { Icon: SiNetlify, color: "#00C7B7" },
  "Fly.io": { Icon: SiFlydotio, color: "#8B5CF6" },
  Render: { Icon: SiRender, color: "#5F5CFF" },
  "GitHub Pages": { Icon: SiGithub },
  Heroku: { Icon: GrHeroku, color: "#79589F" },
  // Front-end frameworks / libs
  "Next.js": { Icon: SiNextdotjs },
  Nuxt: { Icon: SiNuxt, color: "#00DC82" },
  React: { Icon: SiReact, color: "#61DAFB" },
  "Vue.js": { Icon: SiVuedotjs, color: "#4FC08D" },
  Angular: { Icon: SiAngular, color: "#DD0031" },
  Svelte: { Icon: SiSvelte, color: "#FF3E00" },
  SvelteKit: { Icon: SiSvelte, color: "#FF3E00" },
  Astro: { Icon: SiAstro, color: "#BC52EE" },
  Remix: { Icon: SiRemix },
  Gatsby: { Icon: SiGatsby, color: "#663399" },
  Preact: { Icon: SiPreact, color: "#673AB8" },
  SolidJS: { Icon: SiSolid, color: "#2C4F7C" },
  Qwik: { Icon: SiQwik, color: "#AC7EF4" },
  "Ember.js": { Icon: SiEmberdotjs, color: "#E04E39" },
  "Alpine.js": { Icon: SiAlpinedotjs, color: "#8BC0D0" },
  htmx: { Icon: SiHtmx, color: "#3465A4" },
  "Tailwind CSS": { Icon: SiTailwindcss, color: "#06B6D4" },
  Bootstrap: { Icon: SiBootstrap, color: "#7952B3" },
  jQuery: { Icon: SiJquery, color: "#0769AD" },
  "Stripe.js": { Icon: SiStripe, color: "#635BFF" },
  "Google Analytics": { Icon: SiGoogleanalytics, color: "#E37400" },
  "Google Tag Manager": { Icon: SiGoogletagmanager, color: "#246FDB" },
  // Back-end frameworks / languages / servers
  Laravel: { Icon: SiLaravel, color: "#FF2D20" },
  Django: { Icon: SiDjango, color: "#44B78B" },
  Express: { Icon: SiExpress },
  "ASP.NET": { Icon: SiDotnet, color: "#8A56E2" },
  PHP: { Icon: SiPhp, color: "#8892BF" },
  Python: { Icon: SiPython, color: "#3776AB" },
  nginx: { Icon: SiNginx, color: "#009639" },
  "Apache HTTP Server": { Icon: SiApache, color: "#D22128" },
  "Apache Tomcat": { Icon: SiApachetomcat, color: "#F8DC75" },
  Caddy: { Icon: SiCaddy, color: "#1F88C0" },
  Gunicorn: { Icon: SiGunicorn, color: "#499848" },
  // CMS / site generators
  WordPress: { Icon: SiWordpress, color: "#21759B" },
  Drupal: { Icon: SiDrupal, color: "#0678BE" },
  Joomla: { Icon: SiJoomla, color: "#5091CD" },
  Shopify: { Icon: SiShopify, color: "#7AB55C" },
  Magento: { Icon: FaMagento, color: "#EE672F" },
  Ghost: { Icon: SiGhost, color: "#738A94" },
  Hugo: { Icon: SiHugo, color: "#FF4088" },
  Jekyll: { Icon: SiJekyll, color: "#CC0000" },
  Docusaurus: { Icon: SiDocusaurus, color: "#3ECC5F" },
  Webflow: { Icon: SiWebflow, color: "#146EF5" },
  HubSpot: { Icon: SiHubspot, color: "#FF7A59" },
  PrestaShop: { Icon: SiPrestashop, color: "#DF0067" },
};

/**
 * A technology's brand icon, or a neutral fallback. `className` sizes it (the
 * icon inherits it); a mapped brand color is applied inline where one is set.
 */
export function TechIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const brand = BRANDS[name];
  if (!brand) {
    return (
      <Boxes aria-hidden className={cn("text-muted-foreground", className)} />
    );
  }
  const { Icon, color } = brand;
  return (
    <Icon
      aria-hidden
      className={cn(!color && "text-foreground", className)}
      style={color ? { color } : undefined}
    />
  );
}
