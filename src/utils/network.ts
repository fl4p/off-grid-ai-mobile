import { getIpAddress } from 'react-native-device-info';

/**
 * Returns true if the IPv4 address belongs to a private network: RFC 1918
 * (10/8, 172.16/12, 192.168/16) or the RFC 6598 CGNAT range (100.64/10) that
 * Tailscale/Headscale hand out, which is reachable like a LAN host.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

/** Returns true if the string looks like an IPv6 address */
export function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * Returns true if the device appears to be on a local WiFi network.
 * Returns false if on mobile data, no network, or an unexpected address.
 */
export async function isOnLocalNetwork(): Promise<boolean> {
  try {
    const ip = await getIpAddress();
    if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') return false;
    if (isIPv6(ip)) return false;
    return isPrivateIPv4(ip);
  } catch {
    return false;
  }
}
