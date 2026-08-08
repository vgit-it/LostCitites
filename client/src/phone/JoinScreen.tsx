// Code, seat and name entry. Shown once per device — after a successful
// join the membership is persisted, so a refresh goes straight to the game.

import { useState } from 'react';
import { Seat } from '@shared/types';

export function JoinScreen({
  onJoin,
}: {
  onJoin: (code: string, seat: Seat, name: string) => void;
}) {
  const [code, setCode] = useState('');
  const [seat, setSeat] = useState<Seat>(0);
  const [name, setName] = useState('');

  const ready = /^[1-9][0-9]{2}$/.test(code) && name.trim().length > 0;

  return (
    <form
      className="join"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onJoin(code, seat, name.trim());
      }}
    >
      <h1 className="join__title">Lost Cities</h1>

      <label className="join__field">
        <span className="label">Room code</span>
        <input
          className="join__code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          placeholder="000"
          autoFocus
        />
      </label>

      <label className="join__field">
        <span className="label">Your name</span>
        <input
          className="join__name"
          value={name}
          maxLength={12}
          onChange={(event) => setName(event.target.value)}
          placeholder="Paul"
        />
      </label>

      <fieldset className="join__field join__seats">
        <legend className="label">Seat</legend>
        {([0, 1] as Seat[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`action ${seat === option ? 'is-selected' : ''}`}
            onClick={() => setSeat(option)}
          >
            Seat {option + 1}
          </button>
        ))}
      </fieldset>

      <button type="submit" className="action action--play" disabled={!ready}>
        Join
      </button>
      <p className="label join__hint">The code is on the tablet.</p>
    </form>
  );
}
