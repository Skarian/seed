/** Random identity that also works when Seed is opened over plain HTTP on a LAN. */
export function clientId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
