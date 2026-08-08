// ============================================================
// The demo's entry point, and the only module main.tsx knows about.
//
// Loaded through a dynamic import so everything under demo/ — including
// the server it runs — lands in its own chunk. The LAN build never ships
// it and never downloads it.
// ============================================================

import { DemoIndex } from './DemoIndex';
import { DemoRoute } from './DemoRoute';
import { DemoParams } from './route';
import './demo.css';

export default function DemoApp({ params }: { params: DemoParams }) {
  if (params.view === 'table' || params.view === 'play') {
    return <DemoRoute params={params} />;
  }
  return <DemoIndex params={params} />;
}
