export default function shortenAddress(address: string) {
  if (!address) return '';
  return address?.slice(0, 2) + '...' + address?.slice(-4);
}
