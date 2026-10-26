export const DEFAULT_API_HOST: string;
export const MAX_DESCRIPTION_LENGTH: number;
export function normalizeApiHost(raw: string | undefined): string;
export function resolveManifest(
  template: Record<string, unknown>,
  options: { version: string; apiHost: string | undefined },
): Record<string, unknown> & { description: string };
