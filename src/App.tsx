import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from './store/auth';
import { AuthScreen } from './components/auth/AuthScreen';
import { AppShell } from './components/layout/AppShell';
import { LogoMark } from './components/ui/Logo';
import { ConfirmDialog, Toaster } from './components/ui/Overlays';

function Splash() {
  return (
    <div className="splash" aria-busy="true" aria-label="Loading Voris AI">
      <LogoMark size={52} className="splash-mark" />
    </div>
  );
}

function BootError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="splash">
      <div className="boot-error">
        <LogoMark size={44} />
        <h1>Can’t reach Voris AI</h1>
        <p>{message}</p>
        <button className="btn btn-primary" onClick={retry}>
          <RefreshCw size={15} /> Try again
        </button>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const status = useAuth((s) => s.status);
  const bootError = useAuth((s) => s.bootError);
  const boot = useAuth((s) => s.boot);

  useEffect(() => {
    boot();
  }, [boot]);

  if (status === 'loading') return <Splash />;
  if (status === 'error') return <BootError message={bootError ?? 'Unknown error'} retry={boot} />;

  return (
    <>
      <Routes>
        <Route path="/login" element={<GuestOnly><AuthScreen mode="login" /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><AuthScreen mode="signup" /></GuestOnly>} />
        <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>} />
        <Route path="/c/:chatId" element={<RequireAuth><AppShell /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
      <ConfirmDialog />
    </>
  );
}
