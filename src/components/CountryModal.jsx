import React, { useState } from 'react';
import { Search, X, Check } from 'lucide-react';

const ALL_COUNTRIES = [
  { code: 'BR', name: 'Brasil', flag: '🇧🇷', suggested: true },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', suggested: true },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸', suggested: true },
  { code: 'ES', name: 'Espanha', flag: '🇪🇸', suggested: true },
  { code: 'FR', name: 'França', flag: '🇫🇷', suggested: true },
  { code: 'IT', name: 'Itália', flag: '🇮🇹', suggested: false },
  { code: 'DE', name: 'Alemanha', flag: '🇩🇪', suggested: false },
  { code: 'TR', name: 'Turquia', flag: '🇹🇷', suggested: true },
  { code: 'RU', name: 'Rússia', flag: '🇷🇺', suggested: false },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', suggested: true },
  { code: 'CO', name: 'Colômbia', flag: '🇨🇴', suggested: false },
  { code: 'GB', name: 'Reino Unido', flag: '🇬🇧', suggested: false },
  { code: 'JP', name: 'Japão', flag: '🇯🇵', suggested: false },
  { code: 'KR', name: 'Coreia do Sul', flag: '🇰🇷', suggested: false },
];

export default function CountryModal({ isOpen, onClose, selectedCountries, onSave }) {
  const [search, setSearch] = useState('');
  const [tempSelected, setTempSelected] = useState([...selectedCountries]);

  if (!isOpen) return null;

  const handleToggle = (code) => {
    if (tempSelected.includes(code)) {
      setTempSelected(tempSelected.filter(c => c !== code));
    } else {
      setTempSelected([...tempSelected, code]);
    }
  };

  const handleSelectAll = () => {
    setTempSelected(ALL_COUNTRIES.map(c => c.code));
  };

  const handleClearAll = () => {
    setTempSelected([]);
  };

  const filteredCountries = ALL_COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  const suggestedCountries = filteredCountries.filter(c => c.suggested);
  const otherCountries = filteredCountries.filter(c => !c.suggested);

  const handleSave = () => {
    onSave(tempSelected);
    onClose();
  };

  return (
    <div style={styles.overlay} className="country-modal-overlay">
      <div style={styles.container} className="glass-panel country-modal">
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Selecionar País</h2>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={styles.searchContainer}>
          <Search size={18} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Pesquisar país..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        {/* Content Area */}
        <div style={styles.content} className="no-scrollbar">
          {/* Quick Select Buttons */}
          <div style={styles.quickActions}>
            <button onClick={handleSelectAll} style={styles.actionBtn}>Selecionar Todos</button>
            <button onClick={handleClearAll} style={styles.actionBtn}>Limpar Filtro</button>
          </div>

          {/* Suggested Section */}
          {suggestedCountries.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Sugeridos</h3>
              <div style={styles.grid} className="country-grid">
                {suggestedCountries.map(c => (
                  <div
                    key={c.code}
                    onClick={() => handleToggle(c.code)}
                    style={{
                      ...styles.countryCard,
                      backgroundColor: tempSelected.includes(c.code) ? 'rgba(0, 149, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      borderColor: tempSelected.includes(c.code) ? 'var(--primary)' : 'var(--border-light)'
                    }}
                  >
                    <span style={styles.flag}>{c.flag}</span>
                    <span style={styles.name}>{c.name}</span>
                    {tempSelected.includes(c.code) && (
                      <div style={styles.checkBadge}>
                        <Check size={10} color="#fff" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Other Countries Section */}
          {otherCountries.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Outros Países</h3>
              <div style={styles.grid} className="country-grid">
                {otherCountries.map(c => (
                  <div
                    key={c.code}
                    onClick={() => handleToggle(c.code)}
                    style={{
                      ...styles.countryCard,
                      backgroundColor: tempSelected.includes(c.code) ? 'rgba(0, 149, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      borderColor: tempSelected.includes(c.code) ? 'var(--primary)' : 'var(--border-light)'
                    }}
                  >
                    <span style={styles.flag}>{c.flag}</span>
                    <span style={styles.name}>{c.name}</span>
                    {tempSelected.includes(c.code) && (
                      <div style={styles.checkBadge}>
                        <Check size={10} color="#fff" strokeWidth={3} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredCountries.length === 0 && (
            <div style={styles.noResults}>
              Nenhum país encontrado para "{search}"
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>Cancelar</button>
          <button onClick={handleSave} style={styles.saveBtn}>Salvar ({tempSelected.length})</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
    padding: '16px',
  },
  container: {
    width: '100%',
    maxWidth: '520px',
    maxHeight: '85vh',
    borderRadius: '24px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
  },
  header: {
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'between',
    borderBottom: '1px solid var(--border-light)',
  },
  title: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'background-color 0.2s',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      color: '#fff',
    }
  },
  searchContainer: {
    padding: '12px 24px',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: '36px',
    color: 'var(--text-secondary)',
  },
  searchInput: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-light)',
    borderRadius: '12px',
    padding: '12px 12px 12px 42px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s',
    ':focus': {
      borderColor: 'var(--primary)',
    }
  },
  content: {
    padding: '0 24px 20px',
    overflowY: 'auto',
    flex: 1,
  },
  quickActions: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
  },
  actionBtn: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-light)',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      color: '#fff',
    }
  },
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '10px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
  },
  countryCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    borderRadius: '14px',
    border: '1px solid transparent',
    cursor: 'pointer',
    position: 'relative',
    userSelect: 'none',
    transition: 'all 0.15s ease',
  },
  flag: {
    fontSize: '20px',
  },
  name: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#fff',
  },
  checkBadge: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    backgroundColor: 'var(--primary)',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 5px rgba(0, 149, 255, 0.3)',
  },
  noResults: {
    textAlign: 'center',
    color: 'var(--text-secondary)',
    padding: '30px 0',
  },
  footer: {
    padding: '16px 24px',
    display: 'flex',
    gap: '12px',
    borderTop: '1px solid var(--border-light)',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  cancelBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-light)',
    borderRadius: '12px',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      color: '#fff',
    }
  },
  saveBtn: {
    flex: 2,
    padding: '12px',
    backgroundColor: 'var(--primary)',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(0, 149, 255, 0.3)',
    transition: 'all 0.2s',
    ':hover': {
      backgroundColor: 'var(--primary-hover)',
      transform: 'translateY(-1px)',
    }
  }
};
