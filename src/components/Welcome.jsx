export default function Welcome({ onDismiss }) {
  return (
    <div className="fixed inset-0 z-50 bg-bg-0 flex items-center justify-center p-6" data-testid="welcome">
      <div className="card max-w-md w-full space-y-4">
        <div className="text-2xl font-medium">You're set</div>
        <div className="text-ink-1 leading-relaxed">
          Your data stays on this device. Nothing syncs unless you set up encrypted backup in Settings.
        </div>
        <div className="text-sm text-ink-2 leading-relaxed">
          The app works offline after first load. Add it to your home screen from Safari's Share menu for the smoothest experience.
        </div>
        <button className="btn-primary w-full" onClick={onDismiss} data-testid="welcome-dismiss">Got it</button>
      </div>
    </div>
  );
}
