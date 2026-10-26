// linkGuard.ts — which links read-link may open.
//
// Pure: no Deno APIs, no network, no imports, so the app's test runner can load
// it by relative path (app/src/__tests__/readLink.test.ts), the same way it
// loads translate-body/tokenMask.ts.
//
// read-link fetches a page somebody pasted, from Fibonax's own servers. A
// link that names a machine inside a private network, or the server itself,
// would turn that into a way to reach things the person could never reach
// from their own browser. So a link is refused unless it is plainly a public
// web page: https, the standard port, a real domain name, no user name or
// password in it, and no bare IP address. Names that resolve to a private
// address are refused after the lookup too (isPrivateAddress); read-link
// refuses the link when no lookup can be made at all.

/** Longest link accepted. Real page links are far shorter. */
export const MAX_LINK_LENGTH = 2048;

/** Name endings that only ever point inside a private network. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];

/**
 * Why a link may not be read, or '' when it may.
 * Codes are the ones read-link answers with: invalid_link, link_not_allowed.
 */
export function linkProblem(raw: string): '' | 'invalid_link' | 'link_not_allowed' {
  if (typeof raw !== 'string') return 'invalid_link';
  const s = raw.trim();
  if (s === '' || s.length > MAX_LINK_LENGTH) return 'invalid_link';
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return 'invalid_link';
  }
  if (url.protocol !== 'https:') return 'link_not_allowed';
  if (url.username !== '' || url.password !== '') return 'link_not_allowed';
  if (url.port !== '' && url.port !== '443') return 'link_not_allowed';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host === 'localhost') return 'link_not_allowed';
  // A bracketed IPv6 address, or any IPv4 address. The URL parser has already
  // turned decimal, hex and octal spellings (https://2130706433/) into dotted
  // form, so one pattern catches all of them.
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'link_not_allowed';
  if (!host.includes('.')) return 'link_not_allowed';
  for (const suffix of PRIVATE_SUFFIXES) {
    if (host.endsWith(suffix)) return 'link_not_allowed';
  }
  return '';
}

type V4 = [number, number, number, number];

function v4Parts(ip: string): V4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts: V4 = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function privateV4([a, b]: V4): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // shared carrier space
    (a === 169 && b === 254) ||          // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                              // multicast and reserved
  );
}

/**
 * The eight 16-bit groups of an IPv6 address, or null when it is not one.
 * Reads every spelling: `::` anywhere, leading zeros, and an IPv4 tail
 * (`::ffff:10.0.0.1`). Reading only the first group let `::ffff:7f00:1`
 * (127.0.0.1) and `0:0:0:0:0:0:0:1` (::1) pass as public.
 */
function v6Groups(ip: string): number[] | null {
  let s = ip;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const v4 = v4Parts(tail[1] ?? '');
    if (!v4) return null;
    s = s.slice(0, s.length - (tail[1] ?? '').length) +
      ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Whether a resolved address is one a public web page cannot live at:
 * private, loopback, link-local, carrier-shared, multicast or reserved,
 * IPv4 or IPv6 (including IPv4 carried inside IPv6, in any spelling).
 */
export function isPrivateAddress(ip: string): boolean {
  const s = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = v4Parts(s);
  if (v4) return privateV4(v4);
  if (!s.includes(':')) return true;
  const g = v6Groups(s);
  if (!g) return true;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const [a = 0, b = 0, c = 0, , , f = 0, x = 0, y = 0] = g;
  if (zero(0, 7) && (y === 0 || y === 1)) return true;          // :: and ::1
  if (zero(0, 5) && (f === 0xffff || f === 0)) {                // IPv4-mapped, IPv4-compatible
    return privateV4([x >> 8, x & 0xff, y >> 8, y & 0xff]);
  }
  if (a === 0x2002) return privateV4([b >> 8, b & 0xff, c >> 8, c & 0xff]); // 6to4
  return (
    (a === 0x64 && b === 0xff9b) ||   // IPv4 translated
    (a === 0x2001 && b === 0) ||      // Teredo, a tunnel to any IPv4 address
    (a === 0x2001 && b === 0xdb8) ||  // documentation
    (a === 0x100 && zero(1, 4)) ||    // discard
    (a & 0xfe00) === 0xfc00 ||        // unique local fc00::/7
    (a & 0xffc0) === 0xfe80 ||        // link-local fe80::/10
    (a & 0xffc0) === 0xfec0 ||        // site-local fec0::/10
    (a & 0xff00) === 0xff00           // multicast
  );
}
