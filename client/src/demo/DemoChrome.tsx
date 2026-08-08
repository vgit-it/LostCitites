// The controls above the panes.
//
// Every setting lives in the hash and every change reloads: a scenario or a
// seed means a different deal, a different hub and a different set of bots,
// and migrating one live game into another would be a pile of code in
// service of saving a reload nobody minds.

import { SCENARIOS } from './scenarios';
import { DemoParams, demoHash } from './route';

function go(params: Partial<DemoParams>): void {
  window.location.hash = demoHash({ ...params, view: 'panes' });
  window.location.reload();
}

export function DemoChrome({
  params,
  steps,
  reached,
  stopped,
  onDropSeat,
  onStopServer,
}: {
  params: DemoParams;
  steps: number;
  reached: boolean;
  stopped: boolean;
  onDropSeat: () => void;
  onStopServer: () => void;
}) {
  const scenario = SCENARIOS.find((s) => s.id === params.scenario) ?? SCENARIOS[0];

  return (
    <header className="demo-chrome">
      <div className="demo-chrome__row">
        <a className="demo-chrome__home" href={demoHash({ ...params, view: 'index' })}>
          ← Demo
        </a>
        <div className="demo-chrome__scenarios">
          {SCENARIOS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`demo-chip${option.id === scenario.id ? ' is-on' : ''}`}
              onClick={() => go({ ...params, scenario: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="demo-chrome__row">
        <span className="label">
          seed <code>{params.seed}</code> · {steps} half-turns replayed
          {!reached && ' · position not reached'}
        </span>

        <button
          type="button"
          className="demo-chip"
          onClick={() => go({ ...params, seed: 1 + Math.floor(Math.random() * 1e9) })}
        >
          Reshuffle
        </button>

        <button
          type="button"
          className={`demo-chip${params.bot ? ' is-on' : ''}`}
          onClick={() => go({ ...params, bot: !params.bot })}
        >
          {params.bot ? 'Bot on seat 1' : 'You play both seats'}
        </button>

        <button
          type="button"
          className="demo-chip"
          onClick={() => navigator.clipboard?.writeText(window.location.href)}
        >
          Copy link
        </button>

        {/* The two states nothing else can reach. Both are checks the phone
            overhaul's own verification list called for and could not
            automate: a reconnect must not replay a flurry of animations,
            and a refused placement must fly the card home. */}
        <button type="button" className="demo-chip" onClick={onDropSeat}>
          Drop seat 0
        </button>
        <button
          type="button"
          className="demo-chip"
          onClick={onStopServer}
          disabled={stopped}
        >
          {stopped ? 'Server stopped' : 'Stop the server'}
        </button>
      </div>

      <p className="demo-chrome__blurb label">{scenario.blurb}</p>
    </header>
  );
}
