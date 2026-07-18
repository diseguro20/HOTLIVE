import React from 'react';
import { BarChart3, Compass, Flame, Users, Coins, Gift, LogIn, LogOut, Star, UserPlus } from 'lucide-react';

export default function Layout({
  children,
  userCoins,
  selectedCountries,
  onOpenCountryModal,
  onOpenCoinStore,
  currentTab,
  setCurrentTab,
  currentUser,
  profile,
  onOpenAuth,
  onCreateAccount,
  onSignOut
}) {
  const accountName = profile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'Conta';
  const accountInitial = accountName.trim().charAt(0).toUpperCase() || 'U';

  return (
    <div style={styles.layout} className="app-layout">
      {/* Sidebar */}
      <aside style={styles.sidebar} className="app-sidebar">
        {/* Logo */}
        <div style={styles.logoContainer} className="app-logo">
          <div style={styles.logoIcon}>SL</div>
          <span style={styles.logoText}>HOT Live</span>
        </div>

        {/* Navigation Items */}
        <nav style={styles.nav} className="app-nav">
          <button
            className="app-nav-item"
            onClick={() => setCurrentTab('discover')}
            style={{
              ...styles.navItem,
              backgroundColor: currentTab === 'discover' ? 'rgba(0, 149, 255, 0.08)' : 'transparent',
              color: currentTab === 'discover' ? 'var(--primary)' : 'var(--text-secondary)'
            }}
          >
            <Compass size={18} style={styles.navIcon} />
            <span>Descobrir</span>
          </button>
          
          <button
            className="app-nav-item"
            onClick={() => setCurrentTab('popular')}
            style={{
              ...styles.navItem,
              backgroundColor: currentTab === 'popular' ? 'rgba(0, 149, 255, 0.08)' : 'transparent',
              color: currentTab === 'popular' ? 'var(--primary)' : 'var(--text-secondary)'
            }}
          >
            <Flame size={18} style={styles.navIcon} />
            <span>Populares</span>
          </button>

          <button
            className="app-nav-item"
            onClick={() => setCurrentTab('followers')}
            style={{
              ...styles.navItem,
              backgroundColor: currentTab === 'followers' ? 'rgba(0, 149, 255, 0.08)' : 'transparent',
              color: currentTab === 'followers' ? 'var(--primary)' : 'var(--text-secondary)'
            }}
          >
            <Users size={18} style={styles.navIcon} />
            <span>Seguidores</span>
          </button>

          <button
            className="app-nav-item"
            onClick={onOpenCoinStore}
            style={{
              ...styles.navItem,
              color: '#f8c64b'
            }}
          >
            <Coins size={18} style={styles.navIcon} />
            <span>Comprar Moedas</span>
          </button>

          {profile?.is_admin && (
            <button
              className="app-nav-item"
              onClick={() => setCurrentTab('admin')}
              style={{
                ...styles.navItem,
                backgroundColor: currentTab === 'admin' ? 'rgba(255, 56, 129, 0.1)' : 'transparent',
                color: currentTab === 'admin' ? '#ff6b9f' : 'var(--text-secondary)',
              }}
            >
              <BarChart3 size={18} style={styles.navIcon} />
              <span>Administração</span>
            </button>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div style={styles.sidebarFooter} className="app-sidebar-footer">
          <div style={styles.vipPromo} className="glass-panel">
            {currentUser ? <Gift size={18} color="#f8c64b" /> : <Star size={18} color="#f8c64b" />}
            <div style={styles.vipTitle}>
              {currentUser ? (userCoins === 0 ? 'Seu primeiro presente' : 'Destaque-se ao vivo') : 'Entre e seja notado'}
            </div>
            <div style={styles.vipDesc}>
              {currentUser
                ? (userCoins === 0 ? 'Pacotes a partir de R$ 4,90 para começar agora.' : 'Recarregue e continue apoiando suas favoritas.')
                : 'Crie sua conta grátis e comece a interagir nas melhores lives.'}
            </div>
            <button onClick={currentUser ? onOpenCoinStore : onCreateAccount} style={styles.vipBtn}>
              {currentUser ? 'Ver pacotes' : 'Criar conta grátis'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div style={styles.mainContainer} className="app-main-container">
        {/* Header */}
        <header style={styles.header} className="app-header">
          <div style={styles.headerLeft} className="app-header-left">
            {/* Country Selector */}
            <button onClick={onOpenCountryModal} style={styles.countrySelector} className="glass-card app-country-selector">
              <span style={{ marginRight: '6px' }}>🌐</span>
              <span style={{ fontSize: '13px', fontWeight: '600' }}>
                {selectedCountries.length === 0
                  ? 'Todos os países'
                  : selectedCountries.length === 1
                  ? `País: ${selectedCountries[0]}`
                  : `Países: (${selectedCountries.length})`}
              </span>
            </button>
          </div>

          <div style={styles.headerRight} className="app-header-right">
            {currentUser && (
              <>
                <div style={styles.coinsDisplay} onClick={onOpenCoinStore}>
                  <Coins size={15} color="#f8c64b" style={{ marginRight: '6px' }} />
                  <span style={styles.coinsAmount}>{userCoins}</span>
                  <button style={styles.addCoinsBtn} aria-label="Comprar moedas">+</button>
                </div>

                <div style={styles.levelContainer} className="app-level">
                  <div style={styles.levelInfo}>
                    <span style={styles.levelLabel}>LV. 1</span>
                    <span style={styles.levelXp}>0/100 XP</span>
                  </div>
                  <div style={styles.xpBar}>
                    <div style={styles.xpProgress}></div>
                  </div>
                </div>
              </>
            )}

            {currentUser ? (
              <div style={styles.accountArea}>
                <button style={styles.userProfile} title={accountName} aria-label={`Conta de ${accountName}`}>
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={accountName} style={styles.avatar} />
                  ) : (
                    <span style={styles.avatarFallback}>{accountInitial}</span>
                  )}
                  <span style={styles.onlineDot}></span>
                </button>
                <button onClick={onSignOut} style={styles.headerIconButton} aria-label="Sair da conta" title="Sair">
                  <LogOut size={17} />
                </button>
              </div>
            ) : (
              <div style={styles.guestActions} className="app-guest-actions">
                <button onClick={onOpenAuth} style={styles.secondaryLoginButton}>
                  <LogIn size={16} />
                  <span>Entrar</span>
                </button>
                <button onClick={onCreateAccount} style={styles.loginButton}>
                  <UserPlus size={17} />
                  <span>Criar conta grátis</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {(!currentUser || userCoins === 0) && (
          <section style={styles.offerBar} className="app-offer-bar" aria-label="Oferta para começar">
            <div style={styles.offerMessage} className="app-offer-message">
              <Gift size={20} color="#f8c64b" />
              <div>
                <strong style={styles.offerTitle}>
                  {currentUser ? 'Seu saldo está zerado. Comece com 100 moedas.' : 'As melhores lives estão acontecendo agora.'}
                </strong>
                <span style={styles.offerText}>
                  {currentUser ? 'Escolha um pacote a partir de R$ 4,90 e envie seu primeiro presente.' : 'Crie sua conta grátis para conversar, comprar moedas e enviar presentes.'}
                </span>
              </div>
            </div>
            <button onClick={currentUser ? onOpenCoinStore : onCreateAccount} style={styles.offerButton}>
              {currentUser ? 'Comprar moedas' : 'Começar agora'}
            </button>
          </section>
        )}

        {/* Page Content */}
        <main style={styles.content} className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}

const styles = {
  layout: {
    display: 'flex',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: 'var(--bg-dark)',
  },
  sidebar: {
    width: 'var(--sidebar-width)',
    height: '100%',
    backgroundColor: 'var(--bg-sidebar)',
    borderRight: '1px solid var(--border-light)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    zIndex: 90,
  },
  logoContainer: {
    height: 'var(--header-height)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 24px',
    gap: '12px',
    borderBottom: '1px solid var(--border-light)',
  },
  logoIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    background: 'var(--primary-gradient)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '800',
    fontSize: '14px',
    color: '#fff',
    boxShadow: '0 4px 10px rgba(0, 149, 255, 0.3)',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: '800',
    letterSpacing: '0.5px',
    color: '#fff',
  },
  nav: {
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderRadius: '12px',
    border: 'none',
    background: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'all 0.15s ease',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      color: '#fff',
    }
  },
  navIcon: {
    marginRight: '12px',
  },
  sidebarFooter: {
    padding: '16px',
  },
  vipPromo: {
    borderRadius: '16px',
    padding: '14px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  vipTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#f8c64b',
    textTransform: 'uppercase',
    marginBottom: '2px',
  },
  vipDesc: {
    fontSize: '10px',
    color: 'var(--text-secondary)',
    lineHeight: '1.3',
    marginBottom: '10px',
  },
  vipBtn: {
    background: 'var(--gold-gradient)',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    padding: '6px 16px',
    fontSize: '11px',
    fontWeight: '700',
    cursor: 'pointer',
    width: '100%',
  },
  mainContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    height: 'var(--header-height)',
    backgroundColor: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-light)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
  },
  countrySelector: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    borderRadius: '12px',
    border: '1px solid var(--border-light)',
    color: '#fff',
    cursor: 'pointer',
    background: 'rgba(255, 255, 255, 0.02)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  coinsDisplay: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 198, 75, 0.1)',
    border: '1px solid rgba(248, 198, 75, 0.2)',
    padding: '4px 4px 4px 12px',
    borderRadius: '12px',
    cursor: 'pointer',
  },
  coinsAmount: {
    color: '#f8c64b',
    fontWeight: '700',
    fontSize: '14px',
    marginRight: '8px',
  },
  addCoinsBtn: {
    width: '24px',
    height: '24px',
    borderRadius: '8px',
    backgroundColor: '#f8c64b',
    border: 'none',
    color: '#000',
    fontWeight: '800',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  levelContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '100px',
  },
  levelInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  levelLabel: {
    color: 'var(--primary)',
    fontWeight: '700',
  },
  levelXp: {
    fontSize: '9px',
  },
  xpBar: {
    height: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  xpProgress: {
    width: '0%',
    height: '100%',
    backgroundColor: 'var(--primary)',
    borderRadius: '2px',
  },
  userProfile: {
    position: 'relative',
    cursor: 'pointer',
    width: '36px',
    height: '36px',
    padding: 0,
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
  },
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1.5px solid var(--border-light)',
    objectFit: 'cover',
  },
  onlineDot: {
    position: 'absolute',
    bottom: '0',
    right: '0',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--success)',
    border: '1.5px solid var(--bg-surface)',
  },
  avatarFallback: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1.5px solid var(--border-light)',
    backgroundColor: '#2563eb',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 800,
  },
  accountArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  },
  headerIconButton: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    border: '1px solid var(--border-light)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  loginButton: {
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    borderRadius: '7px',
    border: '1px solid rgba(255,56,129,0.35)',
    backgroundColor: 'rgba(255,56,129,0.12)',
    color: '#fff',
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  guestActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  secondaryLoginButton: {
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    borderRadius: '7px',
    border: '1px solid var(--border-light)',
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    padding: '0 11px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  offerBar: {
    minHeight: '58px',
    padding: '9px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px',
    backgroundColor: 'rgba(248, 198, 75, 0.07)',
    borderBottom: '1px solid rgba(248, 198, 75, 0.2)',
    flexShrink: 0,
  },
  offerMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: '11px',
    minWidth: 0,
  },
  offerTitle: {
    display: 'block',
    color: '#fff',
    fontSize: '13px',
    lineHeight: 1.25,
  },
  offerText: {
    display: 'block',
    color: 'var(--text-secondary)',
    fontSize: '11px',
    lineHeight: 1.35,
    marginTop: '2px',
  },
  offerButton: {
    minHeight: '34px',
    flexShrink: 0,
    padding: '0 16px',
    border: 'none',
    borderRadius: '7px',
    background: 'var(--gold-gradient)',
    color: '#111',
    fontSize: '12px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  }
};
