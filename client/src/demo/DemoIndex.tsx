// The way in: pick a position, then open an interface against it.
//
// Every control writes to the hash and reloads. A scenario change means a
// different deal, a different hub and a different set of bots — migrating
// one live game into another would be a pile of code in service of saving a
// reload nobody minds.

import { SCENARIOS } from './scenarios';
import { DemoParams, demoHash } from './route';

function go(params: Partial<DemoParams>): void {
  window.location.hash = demoHash(params);
  window.location.reload();
}

export function DemoIndex({ params }: { params: DemoParams }) {
  const scenario = SCENARIOS.find((s) => s.id === params.scenario) ?? SCENARIOS[0];

  return (
    <div className="demo-index">
      <header className="demo-index__head">
        <h1>Lost Cities — demo</h1>
        <p className="label">
          The real server, running in this tab. No network, no install: the
          rules, the validation and the view filtering are the ones that ship.
        </p>
      </header>

      <section className="demo-index__section">
        <h2 className="label">Position</h2>
        <div className="demo-index__scenarios">
          {SCENARIOS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`demo-chip${option.id === scenario.id ? ' is-on' : ''}`}
              onClick={() => go({ ...params, scenario: option.id, view: 'index' })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="demo-index__blurb label">{scenario.blurb}</p>
      </section>

      <section className="demo-index__section">
        <h2 className="label">Seed</h2>
        <div className="demo-index__row">
          <code className="demo-index__seed">{params.seed}</code>
          <button
            type="button"
            className="demo-chip"
            onClick={() =>
              go({ ...params, view: 'index', seed: 1 + Math.floor(Math.random() * 1e9) })
            }
          >
            Reshuffle
          </button>
        </div>
        <p className="label">
          The position is a pure function of scenario and seed, so this link
          shows the same cards to whoever you send it to.
        </p>
      </section>

      <section className="demo-index__section">
        <h2 className="label">Open</h2>
        <div className="demo-index__row">
          <a className="action action--play" href={demoHash({ ...params, view: 'panes' })}>
            All three, side by side
          </a>
          <a className="action" href={demoHash({ ...params, view: 'table' })}>
            Table
          </a>
          <a className="action" href={demoHash({ ...params, view: 'play', seat: 0 })}>
            Phone — seat 0
          </a>
          <a className="action" href={demoHash({ ...params, view: 'play', seat: 1 })}>
            Phone — seat 1
          </a>
        </div>
        <p className="label">
          Open a phone route on an actual phone, sideways. Each device that
          opens one on its own runs its own game, with a bot in the other
          seat — the panes view is the one where all three share a match.
        </p>
        <p className="label">
          Drawing happens on the table, so a phone opened by itself can place
          a card but not take one. Use the panes view, or the table on one
          device and a phone route on another, to play a turn through.
        </p>
      </section>
    </div>
  );
}
