import { useEffect, useState } from 'react';
import Lock from './components/Lock.jsx';
import BottomTabs from './components/BottomTabs.jsx';
import Dashboard from './views/Dashboard.jsx';
import Sessions from './views/Sessions.jsx';
import NewSession from './views/NewSession.jsx';
import SessionDetail from './views/SessionDetail.jsx';
import Settings from './views/Settings.jsx';
import { isUnlocked, lock, installAutoLock } from './lib/auth.js';
import { getMeta, setMeta, META } from './db/db.js';
import { loadSessionFull } from './state/store.js';

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [route, setRoute] = useState({ name: 'tab' }); // {name:'tab'|'new'|'detail'|'edit'}
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    (async () => {
      const t = (await getMeta(META.THEME)) || 'dark';
      setTheme(t);
      document.documentElement.classList.toggle('light', t === 'light');
    })();
    installAutoLock(() => setUnlocked(false));
  }, []);

  if (!unlocked) {
    return <div className="h-dvh">
      <Lock onUnlock={() => setUnlocked(true)} />
    </div>;
  }

  const goSession = (id) => setRoute({ name: 'detail', id });
  const goNew = () => setRoute({ name: 'new' });
  const goEdit = async (id) => {
    const rec = await loadSessionFull(id);
    setRoute({ name: 'edit', initial: rec });
  };
  const closeRoute = () => setRoute({ name: 'tab' });

  let body;
  if (route.name === 'new') body = <NewSession onDone={() => { closeRoute(); setTab('sessions'); }} />;
  else if (route.name === 'edit') body = <NewSession initial={route.initial} onDone={() => { closeRoute(); }} />;
  else if (route.name === 'detail') body = <SessionDetail id={route.id} onBack={closeRoute} onEdit={goEdit} />;
  else if (tab === 'dashboard') body = <Dashboard goSession={goSession} goNew={goNew} />;
  else if (tab === 'sessions') body = <Sessions goSession={goSession} />;
  else if (tab === 'settings') body = <Settings onLock={() => { lock(); setUnlocked(false); }} />;

  return (
    <div className="h-dvh flex flex-col">
      <main className="flex-1 overflow-auto scroll-area">{body}</main>
      <BottomTabs active={tab} onChange={(t) => { setTab(t); closeRoute(); }} onNew={goNew} />
    </div>
  );
}
