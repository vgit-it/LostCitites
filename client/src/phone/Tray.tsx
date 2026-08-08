// The region between the banner and the hand.
//
// It exists to stop the phone behaving like a form. PlaceActions used to
// *mount* above the hand when you picked a card, which shoved the fan down
// the screen mid-interaction; the draw phase used to unmount the hand
// entirely and put a different screen in its place. The tray never
// unmounts — only its contents swap — so selecting a card costs zero
// reflow and a phase change is a transition rather than a new world.
//
// Presentational: it knows the three things it can be showing and nothing
// about why.

import { ReactNode } from 'react';

export type TrayMode = 'board' | 'place' | 'draw';

export interface TrayProps {
  mode: TrayMode;
  children: ReactNode;
}

export function Tray({ mode, children }: TrayProps) {
  return (
    <div className={`tray tray--${mode}`}>
      {/*
        Keyed on mode so React remounts on a swap and the enter animation
        runs. Enter only, deliberately: an exit animation would mean keeping
        unmounted children alive, which duplicates their buttons in the
        accessibility tree for a payoff nobody notices.
      */}
      <div className="tray__inner" key={mode}>
        {children}
      </div>
    </div>
  );
}
