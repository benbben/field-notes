import { useState, useEffect } from 'react';
import { hasPasscode, setPasscode, tryUnlock, getPasscodeLength } from '../lib/auth.js';

export default function Lock({ onUnlock }) {
  const [mode, setMode] = useState('loading'); // loading | setup | enter
  const [length, setLength] = useState(4);
  const [first, setFirst] = useState('');
  const [confirm, setConfirm] = useState('');
  const [active, setActive] = useState('first'); // setup state
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const has = await hasPasscode();
      if (has) {
        setLength(await getPasscodeLength());
        setMode('enter');
      } else {
        setMode('setup');
      }
    })();
  }, []);

  const reset = () => { setFirst(''); setConfirm(''); setActive('first'); setError(''); };

  const onDigit = async (d) => {
    setError('');
    if (mode === 'setup') {
      if (active === 'first') {
        const next = (first + d).slice(0, length);
        setFirst(next);
        if (next.length === length) setActive('confirm');
      } else {
        const next = (confirm + d).slice(0, length);
        setConfirm(next);
        if (next.length === length) {
          if (next === first) {
            try {
              await setPasscode(next);
              onUnlock();
            } catch (e) {
              setError(e.message);
              reset();
            }
          } else {
            setError('Codes did not match');
            reset();
          }
        }
      }
    } else if (mode === 'enter') {
      const next = (first + d).slice(0, length);
      setFirst(next);
      if (next.length === length) {
        const ok = await tryUnlock(next);
        if (ok) { onUnlock(); }
        else { setError('Incorrect passcode'); setFirst(''); }
      }
    }
  };

  const onBack = () => {
    if (mode === 'setup') {
      if (active === 'first') setFirst(first.slice(0,-1));
      else setConfirm(confirm.slice(0,-1));
    } else {
      setFirst(first.slice(0,-1));
    }
  };

  if (mode === 'loading') return <div className="h-full flex items-center justify-center text-ink-2">…</div>;

  const filledFirst = first.length;
  const filledConfirm = confirm.length;
  const showLengthChoice = mode === 'setup' && first === '' && confirm === '';

  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      <div className="text-center mb-8">
        <div className="text-2xl font-medium mb-2">
          {mode === 'setup'
            ? (active === 'first' ? 'Create passcode' : 'Confirm passcode')
            : 'Enter passcode'}
        </div>
        <div className="text-sm text-ink-2">
          {mode === 'setup'
            ? 'Required to protect your data. Cannot be skipped.'
            : ''}
        </div>
      </div>
      {showLengthChoice && (
        <div className="flex gap-2 mb-6" data-testid="length-choice">
          <button className={`btn ${length===4 ? 'btn-primary':'btn-secondary'}`} onClick={() => setLength(4)}>4 digits</button>
          <button className={`btn ${length===6 ? 'btn-primary':'btn-secondary'}`} onClick={() => setLength(6)}>6 digits</button>
        </div>
      )}
      <div className="flex gap-3 mb-2" data-testid="passcode-dots">
        {Array.from({ length }).map((_, i) => {
          const filled = (mode === 'setup' && active === 'confirm') ? i < filledConfirm : i < filledFirst;
          return <div key={i} className={`w-3 h-3 rounded-full border ${filled ? 'bg-accent border-accent' : 'border-ink-3'}`}></div>;
        })}
      </div>
      <div className="text-sm text-bad min-h-[1.25rem] mb-4" data-testid="lock-error">{error}</div>
      <Keypad onDigit={onDigit} onBack={onBack} />
    </div>
  );
}

function Keypad({ onDigit, onBack }) {
  const rows = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']];
  return (
    <div className="grid grid-cols-3 gap-3 w-72" data-testid="keypad">
      {rows.flat().map((k, idx) => {
        if (k === '') return <div key={idx}></div>;
        if (k === '⌫') return (
          <button key={idx} className="rounded-full h-16 text-xl text-ink-1 hover:bg-bg-2"
                  onClick={onBack} data-testid="key-back">⌫</button>
        );
        return (
          <button key={idx} className="rounded-full h-16 text-2xl bg-bg-2 hover:bg-bg-3"
                  onClick={() => onDigit(k)} data-testid={`key-${k}`}>{k}</button>
        );
      })}
    </div>
  );
}
