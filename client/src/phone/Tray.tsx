// The top of the phone — the table, as far as this player is concerned.
//
// It exists to stop the phone behaving like a form. PlaceActions used to
// *mount* above the hand when you picked a card, which shoved the fan down
// the screen mid-interaction; the draw phase used to unmount the hand
// entirely and put a different screen in its place. The tray never
// unmounts — only its contents swap — so selecting a card costs zero
// reflow and a phase change is a transition rather than a new world.
//
// Its fixed height is what makes it a place rather than a panel: cards
// travel up to it to be committed and down from it when drawn, and a region
// that resized under the gesture would not survive being dragged onto.
//
// Presentational: it knows the four things it can be showing and nothing
// about why.

import { ReactNode } from 'react';

export type TrayMode = 'table' | 'place' | 'draw' | 'drop';

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
