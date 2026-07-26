/**
 * Shared Region Detection for Supabase Edge Functions
 *
 * Provides a unified region-detection implementation used by multiple edge functions
 * (regional-router, regional-auth) to ensure consistent geographic routing.
 */

/**
 * Country codes mapped to EU-WEST region
 * @see https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2
 */
const EU_WEST_COUNTRIES = ['GB', 'FR', 'DE', 'IE', 'NL', 'BE', 'IT', 'ES'];

/**
 * Country codes mapped to AP-SOUTHEAST region
 * @see https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2
 */
const AP_SOUTHEAST_COUNTRIES = ['SG', 'AU', 'JP', 'KR', 'IN', 'NZ', 'HK'];

/**
 * Detects the region from request headers using Cloudflare geolocation and timezone hints.
 *
 * Region detection order:
 * 1. Explicit x-region-override header (if valid)
 * 2. Cloudflare cf-ipcountry header (country-to-region mapping)
 * 3. x-timezone header (timezone-based heuristic)
 * 4. Default: us-east
 *
 * @param req - Request object with headers (e.g., from Deno/Supabase edge function)
 * @returns One of: 'us-east', 'eu-west', 'ap-southeast'
 */
export function detectRegionFromRequest(req: Request): string {
  // Check for explicit region override
  const regionOverride = req.headers.get('x-region-override');
  if (regionOverride && ['us-east', 'eu-west', 'ap-southeast'].includes(regionOverride)) {
    return regionOverride;
  }

  // Detect from Cloudflare country code
  const cfCountry = req.headers.get('cf-ipcountry') || '';
  if (cfCountry) {
    if (EU_WEST_COUNTRIES.includes(cfCountry)) {
      return 'eu-west';
    }
    if (AP_SOUTHEAST_COUNTRIES.includes(cfCountry)) {
      return 'ap-southeast';
    }
  }

  // Detect from timezone (fallback heuristic)
  const tzHeader = req.headers.get('x-timezone') || '';
  if (tzHeader.startsWith('Europe') || tzHeader.startsWith('GMT')) {
    return 'eu-west';
  }
  if (tzHeader.startsWith('Asia') || tzHeader.startsWith('Australia')) {
    return 'ap-southeast';
  }

  // Default to us-east
  return 'us-east';
}
