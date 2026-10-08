import { useEffect, useState } from 'react';
import Lock from './components/Lock.jsx';
import Welcome from './components/Welcome.jsx';
import BottomTabs from './components/BottomTabs.jsx';
import UpdateChip from './components/UpdateChip.jsx';
import Dashboard from './views/Dashboard.jsx';
import Sessions from './views/Sessions.jsx';
import NewSession from './views/NewSession.jsx';
import SessionDetail from './views/SessionDetail.jsx';
import Settings from './views/Settings.jsx';
import { lock, installAutoLock } from './lib/auth.js';
import { getMeta, setMeta, META } from './db/db.js';
import { loadSessionFull } from './state/store.js';

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [route, setRoute] = useState({ name: 'tab' });
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    (async () => {
      const t = (await getMeta(META.THEME)) || 'dark';
      document.documentElement.classList.toggle('light', t === 'light');
    })();
    installAutoLock(() => setUnlocked(false));
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      const seen = await getMeta(META.ONBOARDED);
      if (!seen) setShowWelcome(true);
    })();
  }, [unlocked]);

  const dismissWelcome = async () => {
    setShowWelcome(false);
    await setMeta(META.ONBOARDED, true);
  };

  if (!unlocked) {
    return (
      <div className="app-shell" data-testid="lock-shell">
        <main className="app-main" data-testid="main">
          <Lock onUnlock={() => setUnlocked(true)} />
        </main>
        <UpdateChip />
      </div>
    );
  }

  const goSession = (id) => setRoute({ name: 'detail', id });
  const goNew = () => setRoute({ name: 'new' });
  const goEdit = async (id) => {
    const rec = await loadSessionFull(id);
    setRoute({ name: 'edit', initial: rec });
  };
  const closeRoute = () => setRoute({ name: 'tab' });

  let body;
  // Save lands on Sessions; Cancel (onDone(null)) returns to the tab the user came from.
  if (route.name === 'new') body = <NewSession onDone={(id) => { closeRoute(); if (id) setTab('sessions'); }} />;
  else if (route.name === 'edit') body = <NewSession initial={route.initial} onDone={() => { closeRoute(); }} />;
  else if (route.name === 'detail') body = <SessionDetail id={route.id} onBack={closeRoute} onEdit={goEdit} />;
  else if (tab === 'dashboard') body = <Dashboard goSession={goSession} goNew={goNew} />;
  else if (tab === 'sessions') body = <Sessions goSession={goSession} />;
  else if (tab === 'settings') body = <Settings onLock={() => { lock(); setUnlocked(false); }} />;

  return (
    <div className="app-shell" data-testid="app-shell">
      <main className="app-main" data-testid="main">{body}</main>
      <BottomTabs active={tab} onChange={(t) => { setTab(t); closeRoute(); }} onNew={goNew} />
      {showWelcome && <Welcome onDismiss={dismissWelcome} />}
      <UpdateChip />
    </div>
  );
}
