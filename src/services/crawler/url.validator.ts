export interface URLValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
  isLocal: boolean;
}

const PRIVATE_IPV4_REGEX = [
  /^127\.\d+\.\d+\.\d+$/,                  // 127.0.0.0/8 Loopback
  /^10\.\d+\.\d+\.\d+$/,                   // 10.0.0.0/8 Private
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,  // 172.16.0.0/12 Private
  /^192\.168\.\d+\.\d+$/,                 // 192.168.0.0/16 Private
  /^169\.254\.\d+\.\d+$/,                 // 169.254.0.0/16 Link-local / Cloud metadata
  /^0\.0\.0\.0$/,                         // Wildcard
  /^(255\.255\.255\.255|198\.(1[89])\.\d+\.\d+|24[0-9]\.\d+\.\d+\.\d+|25[0-5]\.\d+\.\d+\.\d+)$/, // broadcast/benchmarking/reserved
];

const PRIVATE_IPV6_REGEX = [
  /^::1$/,                    // Loopback
  /^::$/,                     // Unspecified
  /^fe[89a-f][0-9a-f]:/i,    // Link-local (fe80-feff)
  /^f[cd][0-9a-f]{2}:/i,     // Unique local (fc00::/7)
  /^ff/i,                     // Multicast (ff00::/8)
  /^::ffff:/i,                // IPv4-mapped (validated separately)
  /^2002:/i,                  // 6to4
  /^2001:0:/i,                // Teredo
];

function isPrivateIPv6(hostname: string): boolean {
  // Strip brackets for [::1] style
  const ip = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (PRIVATE_IPV6_REGEX.some(r => r.test(ip))) return true
  // Check IPv4-mapped (::ffff:x.x.x.x)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped && PRIVATE_IPV4_REGEX.some(r => r.test(mapped[1]))) return true
  return false
}

export function validateAndNormalizeUrl(rawUrl: string, allowLocal = false): URLValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string', isLocal: false };
  }

  let parsed: URL;
  try {
    // Add http protocol if missing for resilience
    const formatted = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    parsed = new URL(formatted);
  } catch {
    return { valid: false, error: `Invalid URL format: "${rawUrl}"`, isLocal: false };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol: "${parsed.protocol}"`, isLocal: false };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check if hostname is local/loopback
  const isLocalHost =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1';

  // Hostname must be localhost, a valid IP, or contain a domain dot (e.g. example.com)
  if (!isLocalHost && !hostname.includes('.')) {
    return { valid: false, error: `Invalid domain hostname: "${hostname}"`, isLocal: false };
  }

  // Check private IP patterns (IPv4 and IPv6)
  const ipOnly = hostname.replace(/^\[|\]$/g, '')
  const isPrivateIp = PRIVATE_IPV4_REGEX.some((regex) => regex.test(ipOnly)) || isPrivateIPv6(ipOnly)

  // Determine if local/private is allowed in current context
  const isLocalOrPrivate = isLocalHost || isPrivateIp

  if (isLocalOrPrivate && !allowLocal) {
    return {
      valid: false,
      error: `Access to private/loopback address is restricted: "${hostname}"`,
      isLocal: true,
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    isLocal: isLocalOrPrivate,
  };
}
