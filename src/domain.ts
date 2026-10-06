/** Normalize a request host for exact domain matching. */
export function normalizeDomain(host: string): string | undefined {
  const value = host.trim();
  if (!value || /[\s/\\?#@%[\]*]/u.test(value)) return undefined;

  const [name, port, extra] = value.split(':');
  if (extra !== undefined || (port !== undefined && !/^\d+$/.test(port))) {
    return undefined;
  }
  if (!name) return undefined;

  let domain: string;
  try {
    domain = new URL(`http://${name}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (!domain || domain.length > 253) return undefined;
  const labels = domain.split('.');
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    )
  ) {
    return undefined;
  }
  return domain;
}
