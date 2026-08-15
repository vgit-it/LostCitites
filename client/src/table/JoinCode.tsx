// One QR on the lobby screen, in the app's own ink-on-paper palette rather
// than the library's black-on-white markup.
//
// `shapeRendering="crispEdges"` matters more than it looks like it should: a
// QR anti-aliased at a fractional device-pixel scale is a QR a cheap phone
// camera fails to lock onto, where the same code rendered crisp reads
// instantly.

import { useMemo } from 'react';
import { qrMatrix, qrPath } from './qrCode';

export function JoinCode({ url, label }: { url: string; label: string }) {
  const { d, size } = useMemo(() => qrPath(qrMatrix(url)), [url]);

  return (
    <svg
      className="join-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect width={size} height={size} fill="var(--paper)" />
      <path d={d} fill="var(--ink)" />
    </svg>
  );
}
