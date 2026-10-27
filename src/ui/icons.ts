const wrap = (inner: string, extra = '') => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;

export function partIcon(kind: string): string {
  switch (kind) {
    case 'pod':
      return wrap('<path d="M14 20c0-7 4.5-12 10-12s10 5 10 12v6c0 7-4.5 11-10 11S14 33 14 26z" fill="#FFF1D8"/><path d="M14 16l-3-7 7 3M34 16l3-7-7 3" fill="#FFB9A8"/><circle cx="24" cy="25" r="6" fill="#8FE6E0"/><path d="M21 25h1M26 25h1"/>');
    case 'engine':
      return wrap('<path d="M17 8h14v8c0 3-2 4-2 7l5 12c1 3-1 6-4 6H18c-3 0-5-3-4-6l5-12c0-3-2-4-2-7z" fill="#D7DEE5"/><path d="M17 41h14" stroke="#FF806A"/><path d="M24 16v8"/>');
    case 'tank':
      return wrap('<path d="M16 13c0-3 3-5 8-5s8 2 8 5v22c0 3-3 5-8 5s-8-2-8-5z" fill="#FFF4DC"/><path d="M16 19h16M16 31h16" stroke="#FFB03A"/><path d="M16 24h16" stroke="#55C9C6"/>');
    case 'decoupler':
      return wrap('<rect x="12" y="18" width="24" height="12" rx="3" fill="#FFE0B5"/><path d="M12 24h24" stroke="#FFB03A"/><circle cx="17" cy="21" r="1" fill="#6B5A52"/><circle cx="24" cy="21" r="1" fill="#6B5A52"/><circle cx="31" cy="21" r="1" fill="#6B5A52"/>');
    case 'chute':
      return wrap('<path d="M9 27c0-11 6-17 15-17s15 6 15 17c-3-3-6-4-8 0-2-3-5-4-7 0-2-4-5-3-7 0-2-4-5-3-8 0z" fill="#FFB9A8"/><path d="M24 28v10M18 39h12" /><path d="M16 27l8 1 8-1" stroke="#FFF4DC"/>');
    case 'sas':
      return wrap('<circle cx="24" cy="24" r="14" fill="#D7DEE5"/><circle cx="24" cy="24" r="8" fill="#FFF4DC"/><path d="M24 10v6M24 32v6M10 24h6M32 24h6"/><circle cx="24" cy="24" r="3" fill="#55C9C6"/>');
    case 'rcs':
      return wrap('<rect x="18" y="18" width="12" height="12" rx="2" fill="#D7DEE5"/><path d="M14 21l4 3M14 27l4-3M34 21l-4 3M34 27l-4-3"/><circle cx="24" cy="24" r="2" fill="#FF806A"/>');
    case 'fins':
      return wrap('<path d="M24 10v28" stroke="#6B5A52"/><path d="M24 30L10 42l2-14 12-6M24 30l14 12-2-14-12-6" fill="#7AD9D3"/>');
    case 'legs':
      return wrap('<path d="M17 10v13l-7 17M31 10v13l7 17" stroke="#8F9BAA"/><ellipse cx="9" cy="41" rx="4" ry="2" fill="#FF806A"/><ellipse cx="39" cy="41" rx="4" ry="2" fill="#FF806A"/><path d="M17 10h14" stroke="#FFB03A"/>');
    case 'nose':
      return wrap('<path d="M24 6l9 26H15z" fill="#FFF4DC"/><path d="M15 32h18" stroke="#FF806A"/><path d="M24 16v10" stroke="#55C9C6"/>');
    case 'srb':
      return wrap('<path d="M17 8h14v26c0 3-2 5-2 8h-10c0-3-2-5-2-8z" fill="#FFF4DC"/><path d="M17 15h14M17 24h14" stroke="#FFB03A"/><path d="M19 42h10" stroke="#6B5A52"/>');
    default:
      return wrap('<circle cx="24" cy="24" r="14" fill="#FFF4DC"/>');
  }
}

export function catIcon(): string {
  return `<svg viewBox="0 0 48 48"><path d="M10 20l-2-9 9 4s3-2 7-2 7 2 7 2l9-4-2 9c2 3 3 7 2 11-2 8-8 12-16 12S10 39 8 31c-1-4 0-8 2-11z" fill="#F2A25C" stroke="#6B4A38" stroke-width="2" stroke-linejoin="round"/><ellipse cx="18" cy="27" rx="2.5" ry="3.4" fill="#2A2836"/><ellipse cx="30" cy="27" rx="2.5" ry="3.4" fill="#2A2836"/><circle cx="17.2" cy="26" r=".9" fill="#fff"/><circle cx="29.2" cy="26" r=".9" fill="#fff"/><path d="M21 33c2 1.5 4 1.5 6 0" stroke="#6B4A38" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M8 26l-6-1M8 30l-6 1M40 26l6-1M40 30l6 1" stroke="#6B4A38" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

export function orbitIcon(): string { return wrap('<circle cx="24" cy="24" r="8" fill="#FFE27A" stroke="none"/><ellipse cx="24" cy="24" rx="18" ry="10" stroke="#CDBBFF" transform="rotate(-25 24 24)"/><circle cx="40" cy="15" r="3" fill="#55C9C6" stroke="none"/>'); }
export function radarIcon(): string { return wrap('<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="2" fill="currentColor"/><path d="M24 8v4M40 24h-4M24 40v-4M8 24h4"/>'); }
