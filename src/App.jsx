import React, { useCallback, useState, useEffect } from 'react';
import Layout from './components/Layout';
import DiscoverPage from './components/DiscoverPage';
import CountryModal from './components/CountryModal';
import CoinStoreModal from './components/CoinStoreModal';
import LiveStreamModal from './components/LiveStreamModal';
import AuthModal from './components/AuthModal';
import AdminDashboard from './components/AdminDashboard';
import api from './services/api';
import { getProfile, getSession, onSessionChange, signOut } from './services/platform';

export default function App() {
  const [userCoins, setUserCoins] = useState(0);
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [currentTab, setCurrentTab] = useState('discover');
  
  // Modals state
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [coinStoreModalOpen, setCoinStoreModalOpen] = useState(false);
  const [activeStreamer, setActiveStreamer] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);

  // API loading states
  const [apiReady, setApiReady] = useState(false);
  const [apiError, setApiError] = useState(null);

  // Initialize API
  useEffect(() => {
    async function init() {
      try {
        await api.initApp();
        setApiReady(true);
      } catch (err) {
        setApiError(err.message || "Erro de conexão");
      }
    }
    init();
  }, []);

  useEffect(() => {
    let active = true;

    const applySession = async (session) => {
      if (!active) return;
      const user = session?.user || null;
      setCurrentUser(user);
      if (!user) {
        setProfile(null);
        setUserCoins(0);
        return;
      }

      try {
        const nextProfile = await getProfile();
        if (!active) return;
        setProfile(nextProfile);
        setUserCoins(Number(nextProfile?.coins || 0));
      } catch (error) {
        console.error('Profile loading failed:', error);
      }
    };

    getSession().then(applySession);
    const unsubscribe = onSessionChange(applySession);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleSpendCoins = (amount) => {
    const nextCoins = Math.max(0, userCoins - amount);
    setUserCoins(nextCoins);
  };

  const handleAddCoins = (amount) => {
    const nextCoins = userCoins + amount;
    setUserCoins(nextCoins);
  };

  const refreshProfile = useCallback(async () => {
    if (!currentUser) return;
    const nextProfile = await getProfile();
    setProfile(nextProfile);
    setUserCoins(Number(nextProfile?.coins || 0));
  }, [currentUser]);

  const handleSignOut = async () => {
    await signOut();
  };

  const openAuth = (mode = 'login') => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  if (apiError) {
    return (
      <div style={styles.loaderContainer}>
        <h3 style={{ color: '#ef4444', marginBottom: '12px' }}>Erro de Inicialização</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>{apiError}</p>
        <button onClick={() => window.location.reload()} style={styles.retryBtn}>Tentar Novamente</button>
      </div>
    );
  }

  if (!apiReady) {
    return (
      <div style={styles.loaderContainer}>
        <div style={styles.spinner}></div>
        <p style={{ marginTop: '16px', fontWeight: '600', color: '#fff' }}>Conectando à HOT Live...</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '6px' }}>Inicializando sessão segura</p>
      </div>
    );
  }

  return (
    <Layout
      userCoins={userCoins}
      selectedCountries={selectedCountries}
      onOpenCountryModal={() => setCountryModalOpen(true)}
      onOpenCoinStore={() => setCoinStoreModalOpen(true)}
      currentTab={currentTab}
      setCurrentTab={setCurrentTab}
      currentUser={currentUser}
      profile={profile}
      onOpenAuth={() => openAuth('login')}
      onCreateAccount={() => openAuth('signup')}
      onSignOut={handleSignOut}
    >
      {currentTab === 'admin' && profile?.is_admin ? (
        <AdminDashboard />
      ) : (
        <DiscoverPage
          selectedCountries={selectedCountries}
          onOpenStream={(streamer) => setActiveStreamer(streamer)}
          onOpenCountryModal={() => setCountryModalOpen(true)}
        />
      )}

      {/* Country Selection Modal */}
      <CountryModal
        isOpen={countryModalOpen}
        onClose={() => setCountryModalOpen(false)}
        selectedCountries={selectedCountries}
        onSave={(countries) => setSelectedCountries(countries)}
      />

      {/* Coin Shop Modal */}
      <CoinStoreModal
        isOpen={coinStoreModalOpen}
        onClose={() => setCoinStoreModalOpen(false)}
        userCoins={userCoins}
        onAddCoins={handleAddCoins}
        currentUser={currentUser}
        onRequireAuth={() => openAuth('signup')}
        onPaymentConfirmed={refreshProfile}
      />

      {/* Livestream Overlay Modal */}
      <LiveStreamModal
        isOpen={!!activeStreamer}
        onClose={() => setActiveStreamer(null)}
        streamer={activeStreamer}
        userCoins={userCoins}
        onSpendCoins={handleSpendCoins}
        onOpenCoinStore={() => setCoinStoreModalOpen(true)}
        currentUser={currentUser}
        currentProfile={profile}
        onRequireAuth={() => openAuth('signup')}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
      />
    </Layout>
  );
}

const styles = {
  loaderContainer: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--bg-dark)',
    color: '#fff',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid rgba(255,255,255,0.08)',
    borderTopColor: '#ff3881',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  retryBtn: {
    padding: '10px 20px',
    backgroundColor: '#ff3881',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
  },
};
