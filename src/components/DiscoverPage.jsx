import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Users, Globe, ChevronDown } from 'lucide-react';
import AgoraRTC from 'agora-rtc-sdk-ng';
import api from '../services/api';
import { getCompatibleAgoraCodec } from '../services/agora';

// Discover tab types mapped to API values
const TABS = [
  { id: 0, label: 'Popular', icon: '🔥' },
  { id: 6, label: 'Descobrir', icon: '🧭' },
  { id: 3, label: 'Belezas', icon: '💎' },
  { id: 4, label: 'Novidades', icon: '🆕' },
  { id: 5, label: 'PK', icon: '⚔️' },
];

const PREVIEW_CACHE_TTL = 30000;
const previewCredentialCache = new Map();

function getFlagEmoji(countryCode) {
  if (!countryCode) return '🌐';
  try {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

function isActiveStream(item) {
  const details = item.stream_details || {};
  const status = String(details.status || item.status || '').toLowerCase();
  const inactiveStatuses = new Set(['ended', 'finished', 'offline', 'closed', 'cancelled', 'canceled']);
  return Boolean(details.livestream_id || item.user?.livestream_id)
    && !details.finished_at
    && !details.ended_at
    && !details.deleted_at
    && details.is_live !== false
    && item.is_live !== false
    && !inactiveStatuses.has(status);
}

function getStreamKey(item) {
  return String(item.stream_details?.livestream_id || item.user?.livestream_id || item.user?.user_id || '');
}

function filterCurrentStreams(items, selectedCountries) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = getStreamKey(item);
    if (!key || seen.has(key) || !isActiveStream(item)) return false;
    if (selectedCountries.length > 0 && !selectedCountries.includes(item.user?.country)) return false;
    seen.add(key);
    return true;
  });
}

function StreamCard({ item, onClick, onInactive }) {
  const user = item.user || {};
  const details = item.stream_details || {};
  const profileUrl = user.profile_image?.url || '';
  const name = user.name || 'Streamer';
  const viewers = details.viewer_count || 0;
  const country = user.country || '';
  const flag = getFlagEmoji(country);
  const level = user.level || 1;
  const headline = details.headline || user.bio || '';
  const hasVerified = user.has_verified_badge;
  const streamerRank = user.streamer_rank;
  const livestreamId = details.livestream_id || user.livestream_id;

  const [hovered, setHovered] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewPlayerRef = useRef(null);
  const previewClientRef = useRef(null);
  const previewSessionRef = useRef(0);
  const previewTimeoutRef = useRef(null);

  const leavePreviewClient = async (client) => {
    if (!client) return;
    client.remoteUsers?.forEach((remoteUser) => remoteUser.videoTrack?.stop());
    client.removeAllListeners?.();
    try { await client.leave(); } catch (error) { console.error('Preview leave error:', error); }
  };

  const stopPreview = () => {
    previewSessionRef.current += 1;
    clearTimeout(previewTimeoutRef.current);
    setHovered(false);
    setPreviewLoading(false);
    setPreviewPlaying(false);
    const client = previewClientRef.current;
    previewClientRef.current = null;
    leavePreviewClient(client);
  };

  const startPreview = async () => {
    setHovered(true);
    if (!livestreamId || previewClientRef.current) return;

    const session = previewSessionRef.current + 1;
    previewSessionRef.current = session;
    setPreviewLoading(true);

    try {
      const cachedPreview = previewCredentialCache.get(String(livestreamId));
      let stream = details.channel_id && details.agora_channel_token
        ? details
        : cachedPreview?.expiresAt > Date.now()
          ? cachedPreview.stream
          : {};

      for (const delay of [0, 120, 240]) {
        if (stream.channel_id && stream.agora_channel_token) break;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (previewSessionRef.current !== session) return;
        const response = await api.retrieveStreamer(livestreamId);
        stream = response?.stream_details || {};
        if (stream.finished_at || (stream.channel_id && stream.agora_channel_token)) break;
      }
      if (previewSessionRef.current !== session) return;
      if (stream.finished_at || !stream.channel_id || !stream.agora_channel_token) {
        if (stream.finished_at) {
          previewCredentialCache.delete(String(livestreamId));
          onInactive(livestreamId);
        }
        setPreviewLoading(false);
        return;
      }

      previewCredentialCache.set(String(livestreamId), {
        stream,
        expiresAt: Date.now() + PREVIEW_CACHE_TTL,
      });

      const codec = await getCompatibleAgoraCodec();
      const client = AgoraRTC.createClient({ mode: 'live', codec });
      previewClientRef.current = client;
      await client.setClientRole('audience');

      const playVideo = async (remoteUser) => {
        if (previewSessionRef.current !== session || previewClientRef.current !== client) return;
        if (!remoteUser.videoTrack) return;
        remoteUser.videoTrack.play(previewPlayerRef.current, { fit: 'cover', mirror: false });
        setPreviewPlaying(true);
        setPreviewLoading(false);
      };

      client.on('user-published', async (remoteUser, mediaType) => {
        if (mediaType !== 'video') return;
        try {
          await client.subscribe(remoteUser, 'video');
          await playVideo(remoteUser);
        } catch (error) {
          console.error('Preview subscribe error:', error);
        }
      });
      client.on('user-unpublished', (remoteUser, mediaType) => {
        if (mediaType === 'video') {
          remoteUser.videoTrack?.stop();
          setPreviewPlaying(false);
        }
      });

      await client.join(
        api.agoraAppId,
        stream.channel_id,
        stream.agora_channel_token,
        stream.agora_id || 0
      );

      if (previewSessionRef.current !== session || previewClientRef.current !== client) {
        await leavePreviewClient(client);
        return;
      }

      previewTimeoutRef.current = setTimeout(() => {
        if (previewSessionRef.current === session && !previewPlayerRef.current?.querySelector('video')) {
          setPreviewLoading(false);
        }
      }, 2500);

      for (const remoteUser of client.remoteUsers) {
        if (!remoteUser.hasVideo) continue;
        await client.subscribe(remoteUser, 'video');
        await playVideo(remoteUser);
      }
    } catch (error) {
      if (previewSessionRef.current === session) {
        previewCredentialCache.delete(String(livestreamId));
        console.error('Live preview error:', error);
        setPreviewLoading(false);
        setPreviewPlaying(false);
      }
    }
  };

  useEffect(() => () => {
    previewSessionRef.current += 1;
    clearTimeout(previewTimeoutRef.current);
    const client = previewClientRef.current;
    previewClientRef.current = null;
    leavePreviewClient(client);
  }, []);

  const handleClick = () => {
    stopPreview();
    onClick();
  };

  return (
    <div
      className="stream-card"
      onClick={handleClick}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      style={{
        ...styles.card,
        transform: hovered ? 'translateY(-4px) scale(1.02)' : 'translateY(0) scale(1)',
        boxShadow: hovered
          ? '0 12px 40px rgba(255, 56, 129, 0.25), 0 0 0 1px rgba(255,56,129,0.3)'
          : '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      {/* Image container */}
      <div style={styles.imageContainer}>
        <img
          src={profileUrl}
          alt={name}
          style={styles.image}
          loading="lazy"
          onError={(e) => {
            e.target.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=60';
          }}
        />

        <div
          ref={previewPlayerRef}
          style={{
            ...styles.previewPlayer,
            opacity: previewPlaying ? 1 : 0,
          }}
          aria-hidden="true"
        />

        {/* Gradient overlay */}
        <div style={styles.imageOverlay} />

        {/* LIVE badge */}
        <div style={styles.liveBadge}>
          <span style={styles.liveDot} />
          <span>LIVE</span>
        </div>

        {/* Viewer count */}
        <div style={styles.viewerBadge}>
          <Users size={11} style={{ marginRight: '3px' }} />
          {viewers.toLocaleString()}
        </div>

        {/* Rank badge if available */}
        {streamerRank && streamerRank <= 100 && (
          <div style={styles.rankBadge}>
            #{streamerRank}
          </div>
        )}

        {hovered && !previewPlaying && (
          <div style={{ ...styles.hoverOverlay, opacity: 1 }}>
            {previewLoading ? <div style={styles.previewSpinner} /> : (
              <span style={styles.hoverText}>Live indisponível para prévia</span>
            )}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div style={styles.cardFooter}>
        <div style={styles.footerLeft}>
          <span style={styles.flag}>{flag}</span>
          <div style={styles.nameBlock}>
            <div style={styles.nameRow}>
              <span style={styles.name}>{name}</span>
              {hasVerified && <span style={styles.verifiedBadge}>✓</span>}
            </div>
            <span style={styles.headline}>{headline.slice(0, 40)}</span>
          </div>
        </div>
        <div style={styles.levelBadge}>
          Lv.{level}
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage({ selectedCountries, onOpenStream, onOpenCountryModal }) {
  const [activeTab, setActiveTab] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const gridRef = useRef(null);
  const refreshRequestRef = useRef(0);
  const pagesLoadedRef = useRef(1);
  const loadingMoreRef = useRef(false);

  const removeInactiveStream = useCallback((livestreamId) => {
    setItems((current) => current.filter((item) => (
      String(item.stream_details?.livestream_id || item.user?.livestream_id) !== String(livestreamId)
    )));
  }, []);

  // Refresh every page the visitor has opened so automatic updates never
  // collapse the expanded grid back to its first page.
  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    let refreshTimer = null;
    pagesLoadedRef.current = 1;

    async function fetchStreams({ initial = false } = {}) {
      if (refreshing) return;
      refreshing = true;
      const requestId = refreshRequestRef.current + 1;
      refreshRequestRef.current = requestId;
      if (initial) setLoading(true);
      try {
        const refreshedItems = [];
        const pageCount = pagesLoadedRef.current;
        let cursor = null;

        for (let page = 0; page < pageCount; page += 1) {
          const res = await api.makeRequest('discover', {
            next: cursor,
            type: activeTab
          });
          refreshedItems.push(...(res.items || []));
          cursor = res.meta?.next || null;
          if (!cursor) break;
        }

        if (!cancelled && requestId === refreshRequestRef.current) {
          setItems(filterCurrentStreams(refreshedItems, selectedCountries));
          setNextCursor(cursor);
        }
      } catch (err) {
        console.error('Failed to fetch streams:', err);
      } finally {
        refreshing = false;
        if (!cancelled && initial) setLoading(false);
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') fetchStreams();
    };

    fetchStreams({ initial: true });
    refreshTimer = window.setInterval(refreshWhenVisible, 15000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeTab, selectedCountries]);

  // Load more on scroll
  const handleLoadMore = async () => {
    if (loadingMoreRef.current || !nextCursor) return;
    loadingMoreRef.current = true;
    refreshRequestRef.current += 1;
    setLoadingMore(true);
    try {
      const res = await api.makeRequest('discover', {
        next: nextCursor,
        type: activeTab
      });
      const newItems = filterCurrentStreams(res.items, selectedCountries);
      setItems((current) => {
        const currentKeys = new Set(current.map(getStreamKey));
        return [...current, ...newItems.filter((item) => !currentKeys.has(getStreamKey(item)))];
      });
      pagesLoadedRef.current += 1;
      setNextCursor(res.meta?.next || null);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const handleCardClick = async (item) => {
    const user = item.user || {};
    const details = item.stream_details || {};
    const livestreamId = details.livestream_id || user.livestream_id;

    try {
      const response = await api.retrieveStreamer(livestreamId);
      const currentDetails = response?.stream_details || {};
      if (currentDetails.finished_at || !isActiveStream({ ...item, stream_details: { ...details, ...currentDetails } })) {
        removeInactiveStream(livestreamId);
        return;
      }
    } catch (error) {
      console.error('Failed to validate live before opening:', error);
    }

    onOpenStream({
      id: user.user_id,
      name: user.name || 'Streamer',
      viewers: details.viewer_count || 0,
      level: user.level || 1,
      image: user.profile_image?.url || '',
      avatar: user.profile_image?.thumbnail_url || user.profile_image?.url || '',
      bio: user.bio || details.headline || '',
      livestreamId,
      countryCode: user.country,
      flag: getFlagEmoji(user.country),
    });
  };

  return (
    <div style={styles.page} className="discover-page">
      {/* Tab bar */}
      <div style={styles.tabBar} className="discover-tab-bar">
        <div style={styles.tabsScroll} className="no-scrollbar discover-tabs-scroll">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...styles.tab,
                ...(activeTab === tab.id ? styles.tabActive : {}),
              }}
            >
              <span style={{ marginRight: '6px' }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <button onClick={onOpenCountryModal} style={styles.countryBtn} className="discover-country-btn">
          <Globe size={14} />
          <span>Países</span>
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Stream count info */}
      {!loading && (
        <div style={styles.countInfo} className="discover-count-info">
          <span style={styles.countDot} />
          <span>{items.length} transmissões ao vivo</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Carregando transmissões ao vivo...</p>
        </div>
      )}

      {/* Grid of streams */}
      {!loading && items.length > 0 && (
        <>
          <div ref={gridRef} style={styles.grid} className="discover-grid">
            {items.map((item) => (
              <StreamCard
                key={getStreamKey(item)}
                item={item}
                onClick={() => handleCardClick(item)}
                onInactive={removeInactiveStream}
              />
            ))}
          </div>

          {/* Load more */}
          {nextCursor && (
            <div style={styles.loadMoreContainer}>
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={styles.loadMoreBtn}
              >
                {loadingMore ? (
                  <div style={{ ...styles.spinner, width: '18px', height: '18px', borderWidth: '2px' }} />
                ) : (
                  'Carregar mais'
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div style={styles.emptyContainer}>
          <span style={{ fontSize: '48px', marginBottom: '16px' }}>📡</span>
          <h3 style={styles.emptyTitle}>Nenhuma transmissão encontrada</h3>
          <p style={styles.emptyText}>
            Tente mudar a aba ou os filtros de país para ver mais streams.
          </p>
          <button onClick={onOpenCountryModal} style={styles.emptyBtn}>
            Alterar Países
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    height: '100%',
    overflowY: 'auto',
    backgroundColor: 'var(--bg-dark)',
    padding: '0',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    position: 'sticky',
    top: 0,
    zIndex: 20,
    backgroundColor: 'var(--bg-dark)',
    backdropFilter: 'blur(12px)',
  },
  tabsScroll: {
    display: 'flex',
    gap: '6px',
    overflowX: 'auto',
    flex: 1,
    marginRight: '12px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.2s',
  },
  tabActive: {
    backgroundColor: '#ff3881',
    borderColor: '#ff3881',
    color: '#fff',
    boxShadow: '0 4px 12px rgba(255,56,129,0.3)',
  },
  countryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  countInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 24px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontWeight: '500',
  },
  countDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    boxShadow: '0 0 6px rgba(34,197,94,0.5)',
    animation: 'pulse-live 2s infinite',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
    padding: '8px 24px 32px',
  },
  card: {
    borderRadius: '16px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: '3 / 4',
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  previewPlayer: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    backgroundColor: '#000',
    transition: 'opacity 0.18s ease',
    pointerEvents: 'none',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
    pointerEvents: 'none',
  },
  liveBadge: {
    position: 'absolute',
    top: '10px',
    left: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: '#ff3881',
    color: '#fff',
    fontSize: '9px',
    fontWeight: '800',
    padding: '3px 8px',
    borderRadius: '6px',
    letterSpacing: '0.5px',
    boxShadow: '0 2px 8px rgba(255,56,129,0.4)',
    zIndex: 4,
  },
  liveDot: {
    width: '5px',
    height: '5px',
    backgroundColor: '#fff',
    borderRadius: '50%',
    animation: 'pulse-live 1.5s infinite',
  },
  viewerBadge: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: '#fff',
    fontSize: '10px',
    fontWeight: '600',
    padding: '3px 8px',
    borderRadius: '6px',
    backdropFilter: 'blur(4px)',
    zIndex: 4,
  },
  rankBadge: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    backgroundColor: 'rgba(248,198,75,0.9)',
    color: '#1a1a2e',
    fontSize: '10px',
    fontWeight: '800',
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: 4,
  },
  hoverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'opacity 0.25s ease',
    pointerEvents: 'none',
    zIndex: 3,
  },
  previewSpinner: {
    width: '28px',
    height: '28px',
    border: '3px solid rgba(255,255,255,0.38)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.8))',
  },
  hoverText: {
    color: '#fff',
    fontSize: '12px',
    fontWeight: '700',
    padding: '6px 9px',
    borderRadius: '6px',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  cardFooter: {
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
  },
  flag: {
    fontSize: '18px',
    flexShrink: 0,
  },
  nameBlock: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  name: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  verifiedBadge: {
    fontSize: '9px',
    backgroundColor: '#3b82f6',
    color: '#fff',
    borderRadius: '50%',
    width: '14px',
    height: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '800',
    flexShrink: 0,
  },
  headline: {
    fontSize: '10px',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  levelBadge: {
    fontSize: '10px',
    fontWeight: '700',
    color: '#f8c64b',
    backgroundColor: 'rgba(248,198,75,0.1)',
    padding: '2px 8px',
    borderRadius: '6px',
    flexShrink: 0,
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 0',
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid rgba(255,255,255,0.06)',
    borderTopColor: '#ff3881',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  loadingText: {
    marginTop: '16px',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '600',
  },
  loadMoreContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: '16px 0 40px',
  },
  loadMoreBtn: {
    padding: '10px 32px',
    backgroundColor: 'rgba(255,56,129,0.1)',
    border: '1px solid rgba(255,56,129,0.3)',
    borderRadius: '12px',
    color: '#ff3881',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '140px',
  },
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 24px',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: '800',
    color: '#fff',
    marginBottom: '8px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    marginBottom: '20px',
    maxWidth: '320px',
  },
  emptyBtn: {
    padding: '10px 24px',
    backgroundColor: '#ff3881',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
  },
};
