import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
export function validateAddress(host: string, port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
  if (host === '127.0.0.1') return;
  const octets = host.split('.').map(Number);
  const privateAddress = octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31);
  const assigned = Object.values(networkInterfaces()).flat().some(address => address?.address === host);
  if (isIP(host) !== 4 || !privateAddress || !assigned) throw new Error('Use loopback or an assigned private IPv4 address. If your LAN address changed, rerun seed setup --host NEW_IP.');
}
