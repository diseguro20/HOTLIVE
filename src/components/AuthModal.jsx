import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, LogIn, UserPlus, X } from 'lucide-react';
import { signIn, signUp } from '../services/platform';

export default function AuthModal({ isOpen, onClose, initialMode = 'login' }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setMessage('');
    setError('');
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setMessage('');
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    setLoading(true);
    try {
      if (mode === 'signup') {
        const data = await signUp({ name: name.trim(), email: email.trim(), password });
        if (data.session) onClose();
        else setMessage('Conta criada. Confira seu e-mail para confirmar o acesso.');
      } else {
        await signIn({ email: email.trim(), password });
        onClose();
      }
    } catch (submitError) {
      setError(submitError.message || 'Não foi possível concluir o acesso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} className="auth-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section style={styles.modal} className="auth-modal" aria-label={mode === 'login' ? 'Entrar na conta' : 'Criar conta'}>
        <header style={styles.header}>
          <div>
            <h2 style={styles.title}>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
            <p style={styles.subtitle}>Entre nas chamadas privadas, compre moedas e envie presentes.</p>
          </div>
          <button onClick={onClose} style={styles.iconButton} aria-label="Fechar autenticação">
            <X size={19} />
          </button>
        </header>

        <div style={styles.segmented}>
          <button onClick={() => switchMode('login')} style={{ ...styles.segment, ...(mode === 'login' ? styles.segmentActive : {}) }}>
            Entrar
          </button>
          <button onClick={() => switchMode('signup')} style={{ ...styles.segment, ...(mode === 'signup' ? styles.segmentActive : {}) }}>
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === 'signup' && (
            <label style={styles.label}>
              Nome da conta
              <input value={name} onChange={(event) => setName(event.target.value)} style={styles.input} required minLength={2} autoComplete="name" />
            </label>
          )}
          <label style={styles.label}>
            E-mail
            <input value={email} onChange={(event) => setEmail(event.target.value)} style={styles.input} required type="email" autoComplete="email" />
          </label>
          <label style={styles.label}>
            Senha
            <span style={styles.passwordField}>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ ...styles.input, paddingRight: '42px' }}
                required
                minLength={6}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button type="button" onClick={() => setShowPassword((current) => !current)} style={styles.passwordButton} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {error && <p style={styles.error}>{error}</p>}
          {message && <p style={styles.success}>{message}</p>}

          <button type="submit" disabled={loading} style={styles.submitButton}>
            {mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />}
            <span>{loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</span>
          </button>
        </form>
      </section>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', backgroundColor: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)' },
  modal: { width: 'min(430px, 100%)', borderRadius: '8px', border: '1px solid var(--border-light)', backgroundColor: '#18181b', boxShadow: '0 24px 60px rgba(0,0,0,0.55)', padding: '22px' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
  title: { margin: 0, color: '#fff', fontSize: '22px', letterSpacing: 0 },
  subtitle: { margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: '12px' },
  iconButton: { width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' },
  segmented: { display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: '20px', padding: '3px', borderRadius: '7px', backgroundColor: 'rgba(255,255,255,0.05)' },
  segment: { border: 'none', borderRadius: '5px', padding: '9px', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontWeight: 700, cursor: 'pointer' },
  segmentActive: { backgroundColor: '#ff3881', color: '#fff' },
  form: { display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '18px' },
  label: { display: 'flex', flexDirection: 'column', gap: '6px', color: '#ddd', fontSize: '12px', fontWeight: 600 },
  input: { width: '100%', minHeight: '42px', boxSizing: 'border-box', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: '#101012', color: '#fff', padding: '0 12px', outline: 'none', fontSize: '14px' },
  passwordField: { position: 'relative', display: 'block' },
  passwordButton: { position: 'absolute', top: '4px', right: '4px', width: '34px', height: '34px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' },
  error: { margin: 0, padding: '9px 10px', borderRadius: '6px', backgroundColor: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: '12px' },
  success: { margin: 0, padding: '9px 10px', borderRadius: '6px', backgroundColor: 'rgba(34,197,94,0.1)', color: '#86efac', fontSize: '12px' },
  submitButton: { minHeight: '44px', border: 'none', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', backgroundColor: '#ff3881', color: '#fff', fontWeight: 800, cursor: 'pointer' },
};
