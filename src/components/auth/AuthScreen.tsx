import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Code2, Eye, EyeOff, Globe2, Lock, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Logo, LogoMark } from '../ui/Logo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup';
  const login = useAuth((s) => s.login);
  const signup = useAuth((s) => s.signup);
  const navigate = useNavigate();
  const bootConfig = useAuth((s) => s.config);
  const [access, setAccess] = useState(bootConfig?.auth ?? { signupOpen: true, hasUsers: true });

  // Private assistant: the first visit creates the owner account; after that sign-up may be closed.
  useEffect(() => {
    let alive = true;
    api
      .config()
      .then((c) => {
        if (!alive) return;
        setAccess(c.auth);
        if (mode === 'login' && !c.auth.hasUsers) navigate('/signup', { replace: true });
        if (mode === 'signup' && !c.auth.signupOpen) navigate('/login', { replace: true });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, navigate]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (isSignup && !name.trim()) errs.name = 'Please enter your name.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Please enter a valid email address.';
    if (!password) errs.password = 'Please enter your password.';
    else if (isSignup && password.length < 8) errs.password = 'Use at least 8 characters.';
    else if (isSignup && (!/[A-Za-z]/.test(password) || !/\d/.test(password))) errs.password = 'Include at least one letter and one number.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (isSignup) await signup(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const strength = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();

  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-brand-glow" />
        <div className="auth-brand-inner">
          <Logo size={34} />
          <div className="auth-brand-copy">
            <LogoMark size={64} className="auth-brand-mark" />
            <h1>
              Intelligence,
              <br />
              <span className="text-gradient">without limits.</span>
            </h1>
            <p>Write, code, research and create with an assistant that understands you — in your language.</p>
          </div>
          <ul className="auth-features">
            <li>
              <span className="auth-feature-icon"><Sparkles size={16} /></span>
              Writing, analysis and creative ideas
            </li>
            <li>
              <span className="auth-feature-icon"><Code2 size={16} /></span>
              Expert coding help with syntax highlighting
            </li>
            <li>
              <span className="auth-feature-icon"><Globe2 size={16} /></span>
              Fluent in English, Oʻzbekcha, Русский, Deutsch and more
            </li>
          </ul>
          <p className="auth-brand-foot">© {new Date().getFullYear()} Voris AI</p>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-logo">
            <Logo size={32} />
          </div>
          <h2 className="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth-subtitle">
            {isSignup ? (access.hasUsers ? 'Start using Voris AI in seconds.' : 'Set up your private Voris AI. This first account is the owner.') : 'Sign in to continue to Voris AI.'}
          </p>

          {error && (
            <div className="alert alert-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate className="auth-form">
            {isSignup && (
              <div className="field">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  className={`input${fieldErrors.name ? ' invalid' : ''}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  maxLength={80}
                  autoFocus
                  aria-invalid={!!fieldErrors.name}
                />
                {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className={`input${fieldErrors.email ? ' invalid' : ''}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                autoFocus={!isSignup}
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-wrap">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  className={`input${fieldErrors.password ? ' invalid' : ''}`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                  aria-invalid={!!fieldErrors.password}
                />
                <button type="button" className="input-addon" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {isSignup && password && (
                <div className="pw-strength" aria-label={`Password strength ${strength} of 4`}>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={i < strength ? `on s${strength}` : ''} />
                  ))}
                </div>
              )}
              {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            </div>

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {isSignup ? 'Create account' : 'Sign in'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </form>

          {(isSignup ? access.hasUsers : access.signupOpen) && (
            <p className="auth-switch">
              {isSignup ? 'Already have an account?' : 'New to Voris AI?'}{' '}
              <Link to={isSignup ? '/login' : '/signup'} replace>
                {isSignup ? 'Sign in' : 'Create an account'}
              </Link>
            </p>
          )}
          <p className="auth-secure">
            <Lock size={12} /> Secured with encrypted passwords and HTTP-only sessions
          </p>
        </div>
      </main>
    </div>
  );
}
