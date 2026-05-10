export default function BottomTabs({ active, onChange, onNew }) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'new', label: 'New', isNew: true },
    { id: 'settings', label: 'Settings' }
  ];
  return (
    <nav className="border-t border-bg-3 bg-bg-1/95 backdrop-blur" data-testid="tabs">
      <div className="max-w-md mx-auto flex">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab-button ${active === t.id ? 'tab-active' : ''}`}
            onClick={() => t.isNew ? onNew() : onChange(t.id)}
            data-testid={`tab-${t.id}`}
          >
            {t.isNew
              ? <div className="w-9 h-9 rounded-full bg-accent text-bg-0 flex items-center justify-center text-xl font-bold">+</div>
              : <span>•</span>}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
