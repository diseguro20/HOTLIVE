import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Users, Coins, Phone, PhoneOff, Gift, Maximize2, Minimize2, MessageCircle, MessageCircleOff } from 'lucide-react';
import AgoraRTC from 'agora-rtc-sdk-ng';
import api from '../services/api';
import { getCompatibleAgoraCodec } from '../services/agora';
import { createPrivateCallRequest, updatePrivateCallRequest } from '../services/platform';

const FALLBACK_GIFTS = [
  { id: '1', giftId: 1, name: 'Coração', image: 'https://cdn.sy3sdcf1e39.link/misc/gifts/8d70c250688c45b2beec105d13a88b31', cost: 8 },
  { id: '2', giftId: 2, name: 'Café', image: 'https://cdn.sy3sdcf1e39.link/misc/gifts/04cb5e73570847e98b0d0edfdb8bf6d2', cost: 39 },
  { id: '3', giftId: 3, name: 'Rosa', image: 'https://cdn.sy3sdcf1e39.link/misc/gifts/b6b53e1e34ce4d5aa216611280e85033', cost: 59 },
];

function resolveGift(gifts, giftName = '', giftId = null) {
  const idMatch = giftId != null
    ? gifts.find((gift) => Number(gift.giftId) === Number(giftId))
    : null;
  if (idMatch) return idMatch;
  const normalized = String(giftName || '').toLocaleLowerCase('pt-BR');
  return gifts.find((gift) => normalized.includes(gift.name.toLocaleLowerCase('pt-BR')))
    || FALLBACK_GIFTS[2];
}

function stopAgoraPlayback(client) {
  client?.remoteUsers?.forEach((user) => {
    user.audioTrack?.stop();
    user.videoTrack?.stop();
  });
}

function stopLocalTracks(tracks) {
  tracks.forEach((track) => {
    track?.stop();
    track?.close();
  });
}

export default function LiveStreamModal({ isOpen, onClose, streamer, userCoins, onSpendCoins, onOpenCoinStore, currentUser, currentProfile, onRequireAuth }) {
  const [chat, setChat] = useState([
    { user: 'Sistema', text: 'Bem-vindo ao chat ao vivo! Conectando...', isSystem: true }
  ]);
  const [inputText, setInputText] = useState('');
  const [viewers, setViewers] = useState(streamer?.viewers || 100);
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  const [gifts, setGifts] = useState([]);
  const [giftCatalogLoading, setGiftCatalogLoading] = useState(true);
  const [giftParticles, setGiftParticles] = useState([]);
  const [activeGiftBanner, setActiveGiftBanner] = useState(null);
  const [activeGiftEffect, setActiveGiftEffect] = useState(null);
  const [videoConnected, setVideoConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connecting' | 'live' | 'error'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenChat, setShowFullscreenChat] = useState(true);
  
  // Call states
  const [callState, setCallState] = useState('idle');
  const [callSeconds, setCallSeconds] = useState(0);
  const [callError, setCallError] = useState('');

  // References for WebSockets & Agora
  const socketRef = useRef(null);
  const rtcClientRef = useRef(null);
  const chatEndRef = useRef(null);
  const fullscreenChatEndRef = useRef(null);
  const videoAreaRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const privateCallIdRef = useRef(null);
  const platformCallIdRef = useRef(null);
  const privateCallTracksRef = useRef([]);
  const privateCallEventHandlerRef = useRef(null);
  const chatUsersRef = useRef(new Map());
  const giftCatalogRef = useRef(FALLBACK_GIFTS);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  giftCatalogRef.current = gifts.length ? gifts : FALLBACK_GIFTS;

  const resolveChatIdentity = async (payload) => {
    const message = payload?.message || {};
    const candidates = [payload?.user, payload?.sender, message.sender, message.user, payload?.guest, payload];
    const identity = candidates.find((candidate) => candidate?.name || candidate?.user_name || candidate?.username || candidate?.user_id || candidate?.id) || {};
    const userId = identity.user_id || identity.id || payload?.user_id || payload?.sender_user_id || message.sender_id;
    let name = identity.name || identity.user_name || identity.username || payload?.user_name || payload?.sender_name;
    let level = identity.level || identity.leveling_progress?.current_level || payload?.level;

    if (!name && userId && chatUsersRef.current.has(String(userId))) {
      return chatUsersRef.current.get(String(userId));
    }

    if (!name && userId) {
      try {
        const response = await api.retrieveUserProfile(userId);
        const profile = response?.user || response?.profile || response;
        name = profile?.name || profile?.username;
        level = level || profile?.level || profile?.leveling_progress?.current_level;
      } catch (error) {
        console.error('Chat profile lookup failed:', error);
      }
    }

    const resolved = {
      userId: userId ? String(userId) : null,
      name: name || (userId ? `Conta #${String(userId).slice(-6)}` : null),
      level,
    };
    if (resolved.userId) chatUsersRef.current.set(resolved.userId, resolved);
    return resolved;
  };

  // Auto-scrolling chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    fullscreenChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  useEffect(() => {
    let active = true;
    setGiftCatalogLoading(true);
    api.fetchGiftCatalog()
      .then((catalog) => {
        if (active) setGifts(catalog.length ? catalog : FALLBACK_GIFTS);
      })
      .catch((error) => {
        console.error('Gift catalog loading failed:', error);
        if (active) setGifts(FALLBACK_GIFTS);
      })
      .finally(() => {
        if (active) setGiftCatalogLoading(false);
      });
    return () => { active = false; };
  }, []);

  // The upstream platform owns billing; this timer only shows elapsed call time.
  useEffect(() => {
    let timer;
    if (isOpen && callState === 'connected') {
      timer = setInterval(() => {
        setCallSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [callState, isOpen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenActive = document.fullscreenElement === videoAreaRef.current;
      setIsFullscreen(fullscreenActive);
      if (!fullscreenActive) setShowGiftPanel(false);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Fetch streamer details, connect WS and join Agora room
  useEffect(() => {
    if (!isOpen || !streamer) return undefined;

    chatUsersRef.current.clear();
    setChat([{ user: 'Sistema', text: 'Bem-vindo ao chat ao vivo! Conectando...', isSystem: true }]);

    let active = true;
    let ws = null;
    let agoraClient = null;
    let heartbeatInterval = null;
    let retryTimeout = null;
    let videoHealthInterval = null;
    let lastVideoBytes = null;
    let stalledVideoChecks = 0;
    let recoveringVideo = false;

    const waitForRetry = (delay) => new Promise((resolve) => {
      retryTimeout = setTimeout(resolve, delay);
    });

    async function retrievePlayableStream() {
      const retryDelays = [0, 600, 1000, 1600, 2500, 4000];
      let latestDetails = null;

      for (const delay of retryDelays) {
        if (delay) await waitForRetry(delay);
        if (!active) return null;

        latestDetails = await api.retrieveStreamer(streamer.livestreamId);
        if (!active) return null;

        const currentStream = latestDetails.stream_details || {};
        if (currentStream.finished_at || (currentStream.channel_id && currentStream.agora_channel_token)) {
          return latestDetails;
        }
      }

      return latestDetails;
    }

    async function recoverRemoteVideo(remoteUser) {
      if (!active || !agoraClient || recoveringVideo || rtcClientRef.current !== agoraClient) return;
      recoveringVideo = true;
      setVideoConnected(false);
      setConnectionStatus('connecting');

      try {
        remoteUser?.videoTrack?.stop();
        if (remoteUser) {
          try { await agoraClient.unsubscribe(remoteUser, 'video'); } catch {}
          await agoraClient.subscribe(remoteUser, 'video');
          if (active && videoPlayerRef.current && remoteUser.videoTrack) {
            remoteUser.videoTrack.play(videoPlayerRef.current, { fit: 'contain', mirror: false });
            setVideoConnected(true);
            setConnectionStatus('live');
            lastVideoBytes = remoteUser.videoTrack.getStats?.().receiveBytes ?? null;
            stalledVideoChecks = 0;
          }
        }
      } catch (error) {
        console.error('Video recovery failed:', error);
      } finally {
        recoveringVideo = false;
      }
    }

    function startVideoHealthMonitor() {
      clearInterval(videoHealthInterval);
      videoHealthInterval = setInterval(() => {
        if (!active || !agoraClient || rtcClientRef.current !== agoraClient) return;
        const remoteUser = agoraClient.remoteUsers.find((user) => user.videoTrack);
        const stats = remoteUser?.videoTrack?.getStats?.();

        if (!remoteUser || !stats) {
          stalledVideoChecks += 1;
        } else {
          const bytesAdvanced = lastVideoBytes == null || stats.receiveBytes > lastVideoBytes;
          const framesMoving = (stats.decodeFrameRate || stats.receiveFrameRate || stats.renderFrameRate || 0) > 0;
          lastVideoBytes = stats.receiveBytes;
          stalledVideoChecks = bytesAdvanced || framesMoving ? 0 : stalledVideoChecks + 1;
        }

        if (stalledVideoChecks >= 2) {
          stalledVideoChecks = 0;
          recoverRemoteVideo(remoteUser);
        }
      }, 3000);
    }

    async function setupStream() {
      try {
        // 1. Fetch streamer details (token, channel id, etc.)
        console.log(`LiveStreamModal: Retrieving details for ${streamer.name} (ID: ${streamer.livestreamId})...`);
        setConnectionStatus('connecting');
        const details = await retrievePlayableStream();
        if (!active) return;
        
        const streamDetails = details?.stream_details || {};
        if (streamDetails.finished_at) {
          onCloseRef.current();
          return;
        }
        if (!streamDetails.channel_id || !streamDetails.agora_channel_token) {
          setVideoConnected(false);
          setConnectionStatus('connecting');
          retryTimeout = setTimeout(setupStream, 3500);
          return;
        }
        const channelId = streamDetails.channel_id;
        const agoraToken = streamDetails.agora_channel_token;
        const agoraUserId = streamDetails.agora_id;
        
        console.log(`[Stream] channel_id: ${channelId}, agora_id: ${agoraUserId}, token length: ${agoraToken?.length || 0}`);
        
        if (streamDetails.viewer_count) {
          setViewers(streamDetails.viewer_count);
        }

        if (streamDetails.headline) {
          setChat(prev => [...prev, { user: 'Sistema', text: `📺 ${streamDetails.headline}`, isSystem: true }]);
        }

        // 2. Setup WebSocket Connection for Live Chat
        console.log("LiveStreamModal: Connecting to Live Chat WebSocket...");
        const wsUrl = `${api.wssUrl}?device=${api.guid}`;
        ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected. Joining room...");
          const joinPayload = {
            id: Math.random().toString(36).substring(7),
            action: "enter_livestream",
            data: {
              livestream_id: Number(streamer.livestreamId)
            }
          };
          ws.send(JSON.stringify(joinPayload));

          heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                id: Math.random().toString(36).substring(7),
                action: "heartbeat",
                data: {
                  state: privateCallTracksRef.current.length
                    ? `private_call:${privateCallIdRef.current}`
                    : `livestream:${streamer.livestreamId}`
                }
              }));
            }
          }, 5000);

          setChat(prev => [...prev, { user: 'Sistema', text: '💬 Chat ao vivo conectado!', isSystem: true }]);
        };

        ws.onmessage = async (event) => {
          try {
            const parsed = JSON.parse(event.data);
            const { type, data } = parsed;
            
            if (type === "livestream_message_sent") {
              const identity = await resolveChatIdentity(data);
              const text = data?.text || data?.message?.text || data?.message?.data?.text;
              if (identity.name && text) {
                setChat(prev => [...prev, { user: identity.name, text, level: identity.level }]);
              }
            } else if (type === "livestream_gift_sent") {
              const identity = await resolveChatIdentity(data);
              const giftObj = data.gift || {};
              const incomingGiftId = giftObj.gift_id || giftObj.id || data?.gift_id;
              const catalogGift = resolveGift(giftCatalogRef.current, giftObj.name || data?.gift_name, incomingGiftId);
              const incomingGiftName = giftObj.name || data?.gift_name || catalogGift.name || 'Presente';
              const giftSender = identity.name || 'Conta ao vivo';
              setChat(prev => [...prev, {
                user: giftSender,
                text: `enviou um presente: ${incomingGiftName}`,
                isGift: true
              }]);
              handleReceiveGiftParticle(incomingGiftName, giftSender, incomingGiftId);
            } else if (type === "livestream_arrival_message" || type === "livestream_vip_enter") {
              const identity = await resolveChatIdentity(data);
              if (identity.name) {
                setChat(prev => [...prev, {
                  user: identity.name,
                  text: 'entrou na live',
                  level: identity.level,
                  isArrival: true,
                }]);
              }
            } else if (type === "livestream_viewers_update") {
              if (data.viewers) {
                setViewers(data.viewers);
              }
            } else if (type === "livestream_ended") {
              setChat(prev => [...prev, { user: 'Sistema', text: '⚠️ Esta transmissão foi encerrada.', isSystem: true }]);
              setConnectionStatus('error');
              setVideoConnected(false);
            } else if (type === "private_call_state") {
              privateCallEventHandlerRef.current?.(data);
            }
          } catch (e) {
            console.error("Error parsing socket event:", e);
          }
        };

        ws.onclose = () => {
          console.log("WebSocket disconnected.");
        };

        // 3. Setup Agora RTC for Video Stream
        if (channelId && agoraToken) {
          console.log(`[AgoraRTC] Connecting to channel: ${channelId}`);
          console.log(`[AgoraRTC] App ID: ${api.agoraAppId}`);
          console.log(`[AgoraRTC] Token prefix: ${agoraToken.substring(0, 20)}...`);
          console.log(`[AgoraRTC] Streamer agora_id (UID): ${agoraUserId}`);
          
          // Create client with av1 codec — this is what the real Superlive uses!
          const compatibleCodec = await getCompatibleAgoraCodec();
          agoraClient = AgoraRTC.createClient({ mode: 'live', codec: compatibleCodec });
          rtcClientRef.current = agoraClient;
          
          // Set as audience
          await agoraClient.setClientRole('audience');
          
          // Handle remote user publishing their stream
          agoraClient.on('user-published', async (user, mediaType) => {
            console.log(`[AgoraRTC] user-published: uid=${user.uid}, type=${mediaType}`);
            try {
              await agoraClient.subscribe(user, mediaType);
              if (!active) {
                user.audioTrack?.stop();
                user.videoTrack?.stop();
                return;
              }
              console.log(`[AgoraRTC] Subscribed to uid=${user.uid}, type=${mediaType}`);
              
              if (mediaType === 'video') {
                setTimeout(() => {
                  const playerDiv = videoPlayerRef.current;
                  if (active && playerDiv) {
                    user.videoTrack.play(playerDiv, { fit: 'contain', mirror: false });
                    setVideoConnected(true);
                    setConnectionStatus('live');
                    lastVideoBytes = user.videoTrack?.getStats?.().receiveBytes ?? null;
                    stalledVideoChecks = 0;
                    console.log(`[AgoraRTC] ✅ Video playing for uid=${user.uid}`);
                  }
                }, 100);
              }
              if (mediaType === 'audio') {
                if (active) user.audioTrack.play();
                console.log(`[AgoraRTC] 🔊 Audio playing for uid=${user.uid}`);
              }
            } catch (subErr) {
              console.error(`[AgoraRTC] Subscribe failed:`, subErr);
            }
          });

          agoraClient.on('user-unpublished', (user, mediaType) => {
            console.log(`[AgoraRTC] user-unpublished: uid=${user.uid}, type=${mediaType}`);
            if (mediaType === 'video') {
              user.videoTrack?.stop();
              setVideoConnected(false);
              setConnectionStatus('connecting');
            }
          });

          agoraClient.on('user-joined', (user) => {
            console.log(`[AgoraRTC] user-joined: uid=${user.uid}`);
          });

          agoraClient.on('connection-state-change', (curState, prevState) => {
            console.log(`[AgoraRTC] Connection: ${prevState} → ${curState}`);
            if (curState === 'DISCONNECTED' || curState === 'FAILED') {
              setVideoConnected(false);
              setConnectionStatus('connecting');
            }
          });

          // JOIN: The real Superlive passes agora_id (streamer UID) as the uid parameter
          // From BkS0xr7w.js: B.join(P.settings.agora.agora_app_id, t, r, a)
          // where a = agora_id from stream_details
          try {
            const joinUid = agoraUserId || 0;
            console.log(`[AgoraRTC] Joining with UID=${joinUid}...`);
            await agoraClient.join(api.agoraAppId, channelId, agoraToken, joinUid);
            console.log("[AgoraRTC] ✅ Join successful!");
            console.log("[AgoraRTC] Remote users in channel:", agoraClient.remoteUsers.map(u => u.uid));
            
            setConnectionStatus('live');
            setChat(prev => [...prev, { user: 'Sistema', text: '🔴 Transmissão ao vivo conectada!', isSystem: true }]);
            startVideoHealthMonitor();
            
            // Subscribe to any users that are already in the channel
            for (const remoteUser of agoraClient.remoteUsers) {
              if (remoteUser.hasVideo) {
                await agoraClient.subscribe(remoteUser, 'video');
                setTimeout(() => {
                  const playerDiv = videoPlayerRef.current;
                  if (active && playerDiv) {
                    remoteUser.videoTrack.play(playerDiv, { fit: 'contain', mirror: false });
                    setVideoConnected(true);
                    lastVideoBytes = remoteUser.videoTrack?.getStats?.().receiveBytes ?? null;
                    stalledVideoChecks = 0;
                  }
                }, 100);
              }
              if (remoteUser.hasAudio) {
                await agoraClient.subscribe(remoteUser, 'audio');
                if (active) remoteUser.audioTrack.play();
              }
            }
          } catch (joinErr) {
            console.error("[AgoraRTC] Join failed:", joinErr);
            setConnectionStatus('error');
            setChat(prev => [...prev, { user: 'Sistema', text: `⚠️ Erro ao conectar ao vídeo: ${joinErr.message || 'Token expirado'}. O chat continua funcionando.`, isSystem: true }]);
          }
        }

      } catch (err) {
        console.error("Failed to connect to stream endpoints:", err);
        setConnectionStatus('error');
        setChat(prev => [...prev, { user: 'Sistema', text: '⚠️ Erro de conexão. Verifique sua internet.', isSystem: true }]);
      }
    }

    setupStream();

    // Cleanup logic
    return () => {
      active = false;
      clearTimeout(retryTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (videoHealthInterval) clearInterval(videoHealthInterval);
      
      // Close websocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send leave_livestream
        const leavePayload = {
          id: Math.random().toString(36).substring(7),
          action: "leave_livestream",
          data: {
            livestream_id: Number(streamer.livestreamId)
          }
        };
        try { ws.send(JSON.stringify(leavePayload)); } catch {}
      }
      try { ws?.close(); } catch (error) { console.error('WebSocket close error:', error); }

      // Close Agora connection
      const currentRtcClient = rtcClientRef.current;
      stopLocalTracks(privateCallTracksRef.current);
      privateCallTracksRef.current = [];
      if (currentRtcClient) {
        stopAgoraPlayback(currentRtcClient);
        currentRtcClient.removeAllListeners?.();
        currentRtcClient.leave().then(() => {
          console.log("Agora left successfully.");
        }).catch(err => {
          console.error("Agora leave error:", err);
        });
      }
      rtcClientRef.current = null;
    };

  }, [isOpen, streamer]);

  const handleReceiveGiftParticle = (giftName, sender = 'Alguém', giftId = null) => {
    const gift = resolveGift(giftCatalogRef.current, giftName, giftId);
    const image = gift.image;
    const newParticle = {
      id: Math.random(),
      image,
      x: Math.floor(Math.random() * 60) + 20,
    };
    setGiftParticles(prev => [...prev, newParticle]);
    setActiveGiftBanner({ giftName, giftImage: image, sender });
    if (gift.videoUrl) {
      const effectId = `${gift.giftId}-${Date.now()}`;
      setActiveGiftEffect({ id: effectId, videoUrl: gift.videoUrl, name: gift.name });
      setTimeout(() => {
        setActiveGiftEffect((current) => current?.id === effectId ? null : current);
      }, Math.min(Math.max(gift.animationDuration || 2500, 1800), 8000));
    }

    setTimeout(() => {
      setGiftParticles(prev => prev.filter(p => p.id !== newParticle.id));
    }, 2500);
    setTimeout(() => setActiveGiftBanner(null), 3000);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    // Append to local chat feed immediately
    const accountName = currentProfile?.full_name || currentUser?.user_metadata?.full_name || 'Você';
    setChat(prev => [...prev, { user: accountName, text: inputText, isUser: true }]);
    const sentText = inputText;
    setInputText('');

    // If WebSocket is open, send it to the real platform chat!
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const chatPayload = {
        id: Math.random().toString(36).substring(7),
        action: "livestream/chat/send_text_message",
        data: {
          livestream_id: Number(streamer.livestreamId),
          text: sentText
        }
      };
      try {
        socketRef.current.send(JSON.stringify(chatPayload));
      } catch (err) {
        console.error("Socket send message error:", err);
      }
    }
  };

  const handleSendGift = (gift) => {
    if (userCoins < gift.cost) {
      setShowGiftPanel(false);
      const confirmStore = window.confirm(`Você precisa de ${gift.cost} moedas para enviar uma ${gift.name}. Deseja recarregar agora?`);
      if (confirmStore) {
        onOpenCoinStore();
      }
      return;
    }

    // Spend coins
    onSpendCoins(gift.cost);
    setShowGiftPanel(false);

    // Show flying particle
    const newParticle = {
      id: Math.random(),
      image: gift.image,
      x: Math.floor(Math.random() * 60) + 20,
    };
    setGiftParticles(prev => [...prev, newParticle]);

    // Show banner
    setActiveGiftBanner({
      giftName: gift.name,
      giftImage: gift.image,
      sender: 'Você',
      streamerName: streamer.name
    });
    if (gift.videoUrl) {
      const effectId = `${gift.giftId}-${Date.now()}`;
      setActiveGiftEffect({ id: effectId, videoUrl: gift.videoUrl, name: gift.name });
      setTimeout(() => {
        setActiveGiftEffect((current) => current?.id === effectId ? null : current);
      }, Math.min(Math.max(gift.animationDuration || 2500, 1800), 8000));
    }

    // Append local message
    setChat(prev => [...prev, {
      user: 'Você',
      text: `enviou um(a) ${gift.name}`,
      isGift: true
    }]);

    // If WebSocket is connected, propagate it to the real stream!
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const giftPayload = {
        id: Math.random().toString(36).substring(7),
        action: "livestream/chat/send_gift",
        data: {
          livestream_id: Number(streamer.livestreamId),
          gift_id: Number(gift.giftId),
          count: 1
        }
      };
      try {
        socketRef.current.send(JSON.stringify(giftPayload));
      } catch (err) {
        console.error("Socket gift send error:", err);
      }
    }

    setTimeout(() => {
      setGiftParticles(prev => prev.filter(p => p.id !== newParticle.id));
    }, 2500);

    setTimeout(() => {
      setActiveGiftBanner(null);
    }, 3000);
  };

  const connectPrivateCall = async (privateCallId) => {
    const callDetails = await api.retrievePrivateCall(privateCallId);
    const { agora_id: agoraId, agora_rtc_token: token, session_id: sessionId } = callDetails || {};
    if (!agoraId || !token || !sessionId) {
      throw new Error('A sala privada ainda não está disponível.');
    }

    const liveClient = rtcClientRef.current;
    if (liveClient) {
      stopAgoraPlayback(liveClient);
      liveClient.removeAllListeners?.();
      try { await liveClient.leave(); } catch (error) { console.error('Live room leave error:', error); }
    }

    const compatibleCodec = await getCompatibleAgoraCodec();
    const privateClient = AgoraRTC.createClient({ mode: 'rtc', codec: compatibleCodec });
    rtcClientRef.current = privateClient;
    privateClient.on('user-published', async (user, mediaType) => {
      await privateClient.subscribe(user, mediaType);
      if (mediaType === 'audio') user.audioTrack?.play();
      if (mediaType === 'video' && videoPlayerRef.current) {
        user.videoTrack?.play(videoPlayerRef.current, { fit: 'contain', mirror: false });
        setVideoConnected(true);
      }
    });
    privateClient.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'audio') user.audioTrack?.stop();
      if (mediaType === 'video') {
        user.videoTrack?.stop();
        setVideoConnected(false);
      }
    });

    await privateClient.join(api.agoraAppId, String(sessionId), token, agoraId);
    const [microphoneTrack, cameraTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
    privateCallTracksRef.current = [microphoneTrack, cameraTrack];
    await privateClient.publish([microphoneTrack, cameraTrack]);

    for (const remoteUser of privateClient.remoteUsers) {
      if (remoteUser.hasAudio) {
        await privateClient.subscribe(remoteUser, 'audio');
        remoteUser.audioTrack?.play();
      }
      if (remoteUser.hasVideo) {
        await privateClient.subscribe(remoteUser, 'video');
        remoteUser.videoTrack?.play(videoPlayerRef.current, { fit: 'contain', mirror: false });
        setVideoConnected(true);
      }
    }

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        id: Math.random().toString(36).substring(7),
        action: 'heartbeat',
        data: { state: `private_call:${privateCallId}` }
      }));
    }
  };

  const handlePrivateCallEvent = async (eventData) => {
    if (!eventData || String(eventData.private_call_id) !== String(privateCallIdRef.current)) return;

    if (eventData.event_type === 'accepted') {
      try {
        await connectPrivateCall(eventData.private_call_id);
        if (platformCallIdRef.current) {
          updatePrivateCallRequest(platformCallIdRef.current, { status: 'connected' })
            .catch((error) => console.error('Private call tracking failed:', error));
        }
        setCallSeconds(0);
        setCallState('connected');
      } catch (error) {
        console.error('Private call connection failed:', error);
        stopLocalTracks(privateCallTracksRef.current);
        privateCallTracksRef.current = [];
        try { await api.endPrivateCall(eventData.private_call_id); } catch (endError) {
          console.error('Private call rollback failed:', endError);
        }
        privateCallIdRef.current = null;
        if (platformCallIdRef.current) {
          updatePrivateCallRequest(platformCallIdRef.current, {
            status: 'failed',
            failureReason: error.message || 'Falha ao conectar a sala de vídeo.',
          }).catch((trackingError) => console.error('Private call tracking failed:', trackingError));
          platformCallIdRef.current = null;
        }
        setCallState('idle');
        alert(error.message || 'Não foi possível conectar a chamada privada.');
      }
      return;
    }

    const finishedStates = ['cancelled', 'rejected', 'finished', 'missed_call', 'no_answer'];
    if (finishedStates.includes(eventData.event_type)) {
      stopLocalTracks(privateCallTracksRef.current);
      privateCallTracksRef.current = [];
      privateCallIdRef.current = null;
      if (platformCallIdRef.current) {
        const status = eventData.event_type === 'finished'
          ? 'ended'
          : eventData.event_type === 'cancelled'
            ? 'cancelled'
            : 'rejected';
        updatePrivateCallRequest(platformCallIdRef.current, { status, durationSeconds: callSeconds })
          .catch((error) => console.error('Private call tracking failed:', error));
        platformCallIdRef.current = null;
      }
      setCallState('idle');
      setCallSeconds(0);
      if (eventData.event_type !== 'cancelled' && eventData.event_type !== 'finished') {
        alert(eventData.extra?.finish_message || 'A pessoa não aceitou a chamada.');
      }
    }
  };
  privateCallEventHandlerRef.current = handlePrivateCallEvent;

  const handleStartCall = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setCallError('');
    setCallState('calling');
    try {
      const trackedCall = await createPrivateCallRequest(streamer);
      platformCallIdRef.current = trackedCall.id;
      const callData = await api.startPrivateVideoCall(streamer.id);
      if (!callData?.private_call_id) throw new Error('Não foi possível criar a sala de chamada.');
      privateCallIdRef.current = callData.private_call_id;
      await updatePrivateCallRequest(trackedCall.id, {
        status: 'ringing',
        upstreamCallId: callData.private_call_id,
      });
    } catch (error) {
      console.error('Private call start failed:', error);
      if (platformCallIdRef.current) {
        updatePrivateCallRequest(platformCallIdRef.current, {
          status: 'failed',
          failureReason: error.message || 'Chamada privada indisponível.',
        }).catch((trackingError) => console.error('Private call tracking failed:', trackingError));
        platformCallIdRef.current = null;
      }
      setCallState('idle');
      const requiresUpstreamAccount = /need to login|login required|unauthorized/i.test(error.message || '');
      setCallError(requiresUpstreamAccount
        ? 'Esta participante ainda não está vinculada ao sistema de chamadas da HOT Live.'
        : (error.message || 'Chamada privada indisponível para esta pessoa.'));
    }
  };

  const handleEndCall = async () => {
    const privateCallId = privateCallIdRef.current;
    if (privateCallId) {
      try {
        if (callState === 'connected') await api.endPrivateCall(privateCallId);
        else await api.cancelPrivateCall(privateCallId);
      } catch (error) {
        console.error('Private call close failed:', error);
      }
    }
    stopLocalTracks(privateCallTracksRef.current);
    privateCallTracksRef.current = [];
    privateCallIdRef.current = null;
    if (platformCallIdRef.current) {
      const status = callState === 'connected' ? 'ended' : 'cancelled';
      updatePrivateCallRequest(platformCallIdRef.current, { status, durationSeconds: callSeconds })
        .catch((error) => console.error('Private call tracking failed:', error));
      platformCallIdRef.current = null;
    }
    setCallState('idle');
    setCallSeconds(0);
    setCallError('');
  };

  const handleClose = () => {
    if (privateCallIdRef.current) {
      const closeRequest = callState === 'connected'
        ? api.endPrivateCall(privateCallIdRef.current)
        : api.cancelPrivateCall(privateCallIdRef.current);
      closeRequest.catch((error) => console.error('Private call close failed:', error));
    }
    stopLocalTracks(privateCallTracksRef.current);
    privateCallTracksRef.current = [];
    privateCallIdRef.current = null;
    if (platformCallIdRef.current) {
      const status = callState === 'connected' ? 'ended' : 'cancelled';
      updatePrivateCallRequest(platformCallIdRef.current, { status, durationSeconds: callSeconds })
        .catch((error) => console.error('Private call tracking failed:', error));
      platformCallIdRef.current = null;
    }
    stopAgoraPlayback(rtcClientRef.current);
    if (document.fullscreenElement === videoAreaRef.current) {
      document.exitFullscreen?.().catch(() => {});
    }
    setIsFullscreen(false);
    setVideoConnected(false);
    setCallState('idle');
    setCallSeconds(0);
    setCallError('');
    onClose();
  };

  const handleToggleFullscreen = async () => {
    try {
      if (isFullscreen || document.fullscreenElement) {
        setIsFullscreen(false);
        await document.exitFullscreen?.();
      } else {
        setShowFullscreenChat(true);
        await videoAreaRef.current?.requestFullscreen?.();
        setIsFullscreen(document.fullscreenElement === videoAreaRef.current);
      }
    } catch (error) {
      setIsFullscreen(false);
      setShowGiftPanel(false);
      console.error('Fullscreen error:', error);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (!isOpen || !streamer) return null;

  return (
    <div style={styles.overlay} className="live-modal-overlay">
      <div
        style={{
          ...styles.container,
          ...(isFullscreen ? styles.fullscreenContainer : {}),
        }}
        className="glass-panel live-modal-container"
      >
        
        {/* Stream / Video Area */}
        <div
          ref={videoAreaRef}
          className="live-video-area"
          style={{
            ...styles.videoArea,
            ...(isFullscreen ? styles.fullscreenVideoArea : {}),
          }}
        >
          {/* Agora video player element - always present in DOM */}
          <div ref={videoPlayerRef} id="agora-video-player" style={{
            ...styles.agoraPlayer,
            zIndex: videoConnected ? 2 : 0,
          }}></div>

          {/* Static image fallback - hidden when video is connected */}
          {!videoConnected && (
            <img src={streamer.image} alt="" style={styles.streamImageFallback} />
          )}
          
          <div style={styles.vignette}></div>

          {activeGiftEffect?.videoUrl && (
            <video
              key={activeGiftEffect.id}
              src={activeGiftEffect.videoUrl}
              style={styles.giftVideoEffect}
              autoPlay
              muted
              playsInline
              aria-label={`Animação do presente ${activeGiftEffect.name}`}
              onEnded={() => setActiveGiftEffect(null)}
            />
          )}

          {/* Connection status overlay */}
          {connectionStatus === 'connecting' && !videoConnected && (
            <div style={styles.connectingOverlay}>
              <div style={styles.connectingSpinner}></div>
              <span style={styles.connectingText}>Conectando à transmissão...</span>
            </div>
          )}

          {/* Banner notification for Gift */}
          {activeGiftBanner && (
            <div style={styles.giftBanner}>
              <img src={activeGiftBanner.giftImage} alt="" style={styles.giftBannerIcon} />
              <div style={styles.giftBannerText}>
                <strong>{activeGiftBanner.sender}</strong> enviou {activeGiftBanner.giftName}
                {activeGiftBanner.streamerName ? ` para ${activeGiftBanner.streamerName}` : ''}!
              </div>
            </div>
          )}

          {/* Flying gift particles */}
          {giftParticles.map(p => (
            <div
              key={p.id}
              className="gift-particle"
              style={{ left: `${p.x}%`, bottom: '20%' }}
            >
              <img src={p.image} alt="" />
            </div>
          ))}

          {isFullscreen && showFullscreenChat && (
            <div style={styles.fullscreenChatOverlay}>
              <div style={styles.fullscreenChatFeed} className="no-scrollbar">
                {chat.slice(-30).map((msg, idx) => (
                  <div key={`${chat.length - 30 + idx}-${msg.user}`} style={styles.fullscreenChatMessage}>
                    {msg.isSystem ? (
                      <span style={styles.fullscreenSystemMsg}>{msg.text}</span>
                    ) : (
                      <>
                        <span style={{
                          ...styles.chatUser,
                          color: msg.isUser ? 'var(--primary)' : msg.isStreamer ? '#ff3881' : '#fff',
                        }}>
                          {msg.level ? `[LV.${msg.level}] ` : ''}{msg.user}:
                        </span>
                        <span style={{ ...styles.chatText, color: msg.isGift ? '#f8c64b' : '#fff' }}> {msg.text}</span>
                      </>
                    )}
                  </div>
                ))}
                <div ref={fullscreenChatEndRef} />
              </div>
            </div>
          )}

          {isFullscreen && (
            <>
              {showGiftPanel && (
                <div style={styles.fullscreenGiftPanel} className="live-fullscreen-gift-panel">
                  <div style={styles.giftPanelHeader}>
                    <span style={styles.giftPanelTitle}>Enviar presente <small style={styles.giftCount}>({gifts.length})</small></span>
                    <button
                      onClick={() => setShowGiftPanel(false)}
                      style={styles.giftPanelClose}
                      aria-label="Fechar presentes"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div style={styles.giftGrid} className="live-gift-grid live-fullscreen-gift-grid">
                    {giftCatalogLoading && <div style={styles.giftCatalogStatus}>Carregando presentes...</div>}
                    {gifts.map((gift) => (
                      <button
                        key={`fullscreen-${gift.id}`}
                        onClick={() => handleSendGift(gift)}
                        style={styles.giftCard}
                        aria-label={`Enviar ${gift.name}`}
                      >
                        <img src={gift.image} alt="" style={styles.giftIcon} loading="lazy" />
                        <span style={styles.giftName}>{gift.name}</span>
                        <span style={styles.giftCost}><Coins size={10} />{gift.cost}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowGiftPanel((current) => !current)}
                style={styles.fullscreenGiftButton}
                className="live-fullscreen-gift-button"
                aria-label={showGiftPanel ? 'Fechar opções de presente' : 'Abrir opções de presente'}
                title={showGiftPanel ? 'Fechar presentes' : 'Enviar presente'}
              >
                <Gift size={22} />
                <span>Presentes</span>
              </button>
            </>
          )}

          {/* Top header overlay */}
          <div style={styles.videoHeader} className="live-video-header">
            <div style={styles.streamerProfile} className="live-streamer-profile">
              <img src={streamer.avatar || streamer.image} alt="" style={styles.miniAvatar} />
              <div>
                <div style={styles.streamerName}>{streamer.name}</div>
                <div style={styles.streamerLevel}>Level {streamer.level || 5}</div>
              </div>
              <button style={styles.followBtn} className="live-follow-btn" onClick={() => alert(`Seguindo ${streamer.name}!`)}>Seguir</button>
            </div>
            
            <div style={styles.videoActions}>
              <div style={{
                ...styles.viewersBadge,
                backgroundColor: connectionStatus === 'live' ? 'rgba(239,68,68,0.7)' : 'rgba(0,0,0,0.5)',
              }}>
                {connectionStatus === 'live' && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff', marginRight: '6px', animation: 'pulse-live 1.5s infinite' }}></span>}
                <Users size={14} style={{ marginRight: '4px' }} />
                <span>{viewers}</span>
              </div>

              {isFullscreen && (
                <button
                  onClick={() => setShowFullscreenChat((current) => !current)}
                  style={styles.closeBtn}
                  aria-label={showFullscreenChat ? 'Ocultar chat' : 'Mostrar chat'}
                  title={showFullscreenChat ? 'Ocultar chat' : 'Mostrar chat'}
                >
                  {showFullscreenChat ? <MessageCircleOff size={19} /> : <MessageCircle size={19} />}
                </button>
              )}

              {isFullscreen && callState === 'idle' && (
                <button
                  onClick={handleStartCall}
                  style={styles.privateCallIconBtn}
                  aria-label="Iniciar chamada de vídeo privada"
                  title="Chamada de vídeo privada"
                >
                  <Phone size={18} />
                </button>
              )}

              <button
                onClick={handleToggleFullscreen}
                style={styles.closeBtn}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Abrir em tela cheia'}
                title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              >
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>

              <button onClick={handleClose} style={styles.closeBtn} aria-label="Fechar transmissão">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Call Status Overlay */}
          {callState === 'calling' && (
            <div style={styles.callOverlay}>
              <div style={styles.callGlassBox}>
                <div style={styles.pulseRing}>
                  <img src={streamer.avatar || streamer.image} alt="" style={styles.callAvatar} />
                </div>
                <h3 style={styles.callTitle}>Ligando para {streamer.name}...</h3>
                <p style={styles.callSub}>Aguardando a pessoa aceitar pela HOT Live...</p>
                <button onClick={handleEndCall} style={styles.cancelCallBtn}>
                  <PhoneOff size={20} />
                  <span>Cancelar</span>
                </button>
              </div>
            </div>
          )}

          {callState === 'connected' && (
            <div style={styles.connectedCallBar}>
              <div style={styles.callTimer}>
                <span style={styles.timerDot}></span>
                <span>Privada {formatTime(callSeconds)}</span>
              </div>
              <button onClick={handleEndCall} style={styles.hangupBtn}>
                <PhoneOff size={20} />
                <span>Desligar</span>
              </button>
            </div>
          )}

        </div>

        {callState === 'idle' && !isFullscreen && (
          <div style={{ ...styles.callActionBar, ...(callError ? styles.callActionBarError : {}) }} className="live-call-action-bar">
            <span style={styles.callActionText} className="live-call-action-text">
              {callError || `Quer falar diretamente com ${streamer.name}?`}
            </span>
            <button onClick={handleStartCall} style={styles.callCTA}>
              <Phone size={17} />
              <span>{callError ? 'Tentar novamente' : 'Chamada privada'}</span>
            </button>
          </div>
        )}

        {/* Interaction Panel (Chat Feed and Inputs) */}
        <div className="live-chat-area" style={{ ...styles.chatArea, ...(isFullscreen ? styles.hiddenInFullscreen : {}) }}>
          {/* Chat Feed */}
          <div style={styles.chatFeed} className="no-scrollbar">
            {chat.map((msg, idx) => (
              <div key={idx} style={styles.chatMessageRow}>
                {!msg.isSystem && (
                  <span style={styles.chatAvatar}>{String(msg.user || '?').trim().charAt(0).toUpperCase()}</span>
                )}
                <div style={styles.chatMessage}>
                {msg.isSystem ? (
                  <span style={styles.systemMsg}>{msg.text}</span>
                ) : msg.isGift ? (
                  <div style={styles.giftMsg}>
                    <span style={styles.chatUser}>{msg.user}:</span>
                    <span style={{ color: '#f8c64b', fontWeight: 'bold' }}> {msg.text}</span>
                  </div>
                ) : (
                  <div>
                    <span style={{
                      ...styles.chatUser,
                      color: msg.isUser ? 'var(--primary)' : msg.isStreamer ? '#ff3881' : '#fff'
                    }}>
                      {msg.level ? `[LV.${msg.level}] ` : ''}{msg.user}:
                    </span>
                    <span style={styles.chatText}> {msg.text}</span>
                  </div>
                )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input & Gifting Trigger */}
          <div style={styles.inputArea} className="live-input-area">
            {currentUser && (
              <div style={styles.coinsDisplay} onClick={onOpenCoinStore}>
                <Coins size={14} color="#f8c64b" style={{ marginRight: '4px' }} />
                <span>{userCoins}</span>
              </div>
            )}

            <form onSubmit={handleSendMessage} style={styles.inputForm}>
              <input
                type="text"
                placeholder="Enviar mensagem..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={styles.chatInput}
                disabled={callState === 'connected'}
              />
              <button type="submit" style={styles.sendBtn} disabled={callState === 'connected'}>
                <Send size={16} />
              </button>
            </form>

            <button
              onClick={() => setShowGiftPanel(!showGiftPanel)}
              style={styles.giftBtn}
              aria-label="Abrir presentes"
              title="Abrir presentes"
            >
              <Gift size={20} color="#ff3881" />
            </button>
          </div>

          {/* Gift selection panel overlay */}
          {showGiftPanel && (
            <div style={styles.giftPanel} className="glass-panel live-gift-panel">
              <div style={styles.giftPanelHeader}>
                <span style={styles.giftPanelTitle}>Enviar presente <small style={styles.giftCount}>({gifts.length})</small></span>
                <button onClick={() => setShowGiftPanel(false)} style={styles.giftPanelClose} aria-label="Fechar presentes">
                  <X size={16} />
                </button>
              </div>
              <div style={styles.giftGrid} className="live-gift-grid">
                {giftCatalogLoading && <div style={styles.giftCatalogStatus}>Carregando presentes...</div>}
                {gifts.map(g => (
                  <button key={g.id} onClick={() => handleSendGift(g)} style={styles.giftCard} aria-label={`Enviar ${g.name}`}>
                    <img src={g.image} alt="" style={styles.giftIcon} loading="lazy" />
                    <span style={styles.giftName}>{g.name}</span>
                    <div style={styles.giftCost}>
                      <Coins size={10} color="#f8c64b" style={{ marginRight: '2px' }} />
                      <span>{g.cost}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside style={styles.giftDock} className="live-gift-dock" aria-label="Presentes rápidos">
          <div style={styles.giftDockTitle}>Presentes <span style={styles.giftCount}>{gifts.length}</span></div>
          <div style={styles.giftDockList} className="no-scrollbar">
            {giftCatalogLoading && <div style={styles.giftDockLoading}>Carregando...</div>}
            {gifts.map((gift) => (
              <button
                key={`dock-${gift.id}`}
                onClick={() => handleSendGift(gift)}
                style={styles.giftDockButton}
                title={`Enviar ${gift.name}`}
                aria-label={`Enviar ${gift.name}`}
              >
                <img src={gift.image} alt="" style={styles.giftDockImage} loading="lazy" />
                <span style={styles.giftDockCost}><Coins size={10} />{gift.cost}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowGiftPanel(true)} style={styles.giftDockMore} title="Ver todos os presentes" aria-label="Ver todos os presentes">
            <Gift size={21} />
          </button>
        </aside>

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
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(8px)',
    padding: '10px',
  },
  container: {
    width: '100%',
    maxWidth: '1560px',
    height: 'calc(100vh - 20px)',
    borderRadius: '8px',
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 330px) minmax(0, 1fr) 116px',
    gridTemplateRows: 'minmax(0, 1fr) auto',
    overflow: 'hidden',
    boxShadow: '0 24px 48px rgba(0, 0, 0, 0.7)',
  },
  fullscreenContainer: {
    maxWidth: 'none',
    width: '100vw',
    height: '100vh',
    borderRadius: 0,
    display: 'block',
  },
  videoArea: {
    gridColumn: '2',
    gridRow: '1',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },
  fullscreenVideoArea: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 0,
  },
  hiddenInFullscreen: {
    display: 'none',
  },
  agoraPlayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  streamImageFallback: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  vignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.7) 100%)',
    pointerEvents: 'none',
    zIndex: 3,
  },
  videoHeader: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  streamerProfile: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: 'calc(100% - 150px)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: '6px 12px 6px 6px',
    borderRadius: '999px',
    backdropFilter: 'blur(8px)',
  },
  miniAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    marginRight: '8px',
    border: '1.5px solid #fff',
    objectFit: 'cover',
  },
  streamerName: {
    fontSize: '13px',
    fontWeight: '700',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#fff',
    lineHeight: '1.2',
  },
  videoActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  streamerLevel: {
    fontSize: '9px',
    color: '#f8c64b',
    fontWeight: '600',
  },
  followBtn: {
    backgroundColor: '#ff3881',
    border: 'none',
    borderRadius: '999px',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '700',
    padding: '4px 10px',
    marginLeft: '10px',
    cursor: 'pointer',
  },
  viewersBadge: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: '6px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    backdropFilter: 'blur(8px)',
  },
  closeBtn: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(8px)',
  },
  callActionBar: {
    gridColumn: '2',
    gridRow: '2',
    minHeight: '52px',
    padding: '8px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexShrink: 0,
    backgroundColor: 'var(--bg-surface)',
    borderTop: '1px solid var(--border-light)',
    borderBottom: '1px solid var(--border-light)',
  },
  callActionBarError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  callActionText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    fontWeight: 600,
  },
  callCTA: {
    minHeight: '36px',
    padding: '0 14px',
    backgroundColor: 'var(--primary)',
    color: '#fff',
    border: 'none',
    borderRadius: '7px',
    fontWeight: '700',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    flexShrink: 0,
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(0, 149, 255, 0.4)',
    transition: 'background-color 0.2s',
  },
  privateCallIconBtn: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(0, 149, 255, 0.45)',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 149, 255, 0.72)',
    color: '#fff',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
  },
  chatArea: {
    gridColumn: '1',
    gridRow: '1 / span 2',
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: 'var(--bg-surface)',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--border-light)',
    position: 'relative',
  },
  chatFeed: {
    flex: 1,
    minHeight: 0,
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  fullscreenChatOverlay: {
    position: 'absolute',
    left: '20px',
    bottom: '88px',
    width: 'min(380px, calc(100vw - 40px))',
    maxHeight: '42vh',
    zIndex: 9,
    overflow: 'hidden',
    borderRadius: '8px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    backdropFilter: 'blur(8px)',
  },
  fullscreenChatFeed: {
    maxHeight: '42vh',
    overflowY: 'auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fullscreenChatMessage: {
    fontSize: '13px',
    lineHeight: 1.35,
    wordBreak: 'break-word',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.9)',
  },
  fullscreenSystemMsg: {
    color: '#fbbf24',
    fontSize: '11px',
    fontStyle: 'italic',
  },
  fullscreenGiftButton: {
    position: 'absolute',
    right: '22px',
    bottom: '22px',
    zIndex: 24,
    minHeight: '50px',
    padding: '0 18px',
    border: '2px solid rgba(255, 255, 255, 0.9)',
    borderRadius: '26px',
    backgroundColor: '#ff2f7d',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 0 0 5px rgba(255, 47, 125, 0.22), 0 12px 30px rgba(0, 0, 0, 0.48)',
  },
  fullscreenGiftPanel: {
    position: 'absolute',
    right: '22px',
    bottom: '88px',
    zIndex: 23,
    width: 'min(380px, calc(100vw - 32px))',
    padding: '16px',
    borderRadius: '8px',
    backgroundColor: 'rgba(18, 18, 21, 0.94)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    boxShadow: '0 18px 42px rgba(0, 0, 0, 0.62)',
    backdropFilter: 'blur(12px)',
    maxHeight: 'min(70vh, 620px)',
    overflowY: 'auto',
  },
  chatMessage: {
    fontSize: '13px',
    lineHeight: '1.4',
    wordBreak: 'break-word',
  },
  chatMessageRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
  },
  chatAvatar: {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(96, 165, 250, 0.22)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 800,
  },
  chatUser: {
    fontWeight: '700',
    color: '#fff',
  },
  chatText: {
    color: '#e5e5e5',
  },
  systemMsg: {
    color: 'var(--warning)',
    fontWeight: '500',
    fontSize: '11px',
    fontStyle: 'italic',
  },
  giftMsg: {
    backgroundColor: 'rgba(248, 198, 75, 0.05)',
    border: '1px solid rgba(248, 198, 75, 0.1)',
    borderRadius: '6px',
    padding: '4px 8px',
  },
  inputArea: {
    padding: '12px 16px',
    borderTop: '1px solid var(--border-light)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  coinsDisplay: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-light)',
    padding: '6px 10px',
    borderRadius: '10px',
    fontSize: '12px',
    color: '#fff',
    fontWeight: '700',
    cursor: 'pointer',
  },
  inputForm: {
    flex: 1,
    display: 'flex',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-light)',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  chatInput: {
    flex: 1,
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: '13px',
    padding: '10px 12px',
    outline: 'none',
  },
  sendBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--primary)',
    padding: '0 12px',
    cursor: 'pointer',
  },
  giftBtn: {
    backgroundColor: 'rgba(255, 56, 129, 0.1)',
    border: '1px solid rgba(255, 56, 129, 0.2)',
    width: '38px',
    height: '38px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  giftPanel: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    borderRadius: '24px 24px 0 0',
    padding: '16px 20px 24px',
    zIndex: 20,
    boxShadow: '0 -10px 25px rgba(0, 0, 0, 0.5)',
    maxHeight: '72vh',
    overflowY: 'auto',
  },
  giftPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  giftPanelTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#fff',
  },
  giftCount: {
    color: '#f8c64b',
    fontSize: '10px',
    fontWeight: 800,
  },
  giftPanelClose: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  giftGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
  },
  giftCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-light)',
    borderRadius: '8px',
    padding: '12px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  giftIcon: {
    width: '58px',
    height: '58px',
    objectFit: 'contain',
    marginBottom: '4px',
  },
  giftName: {
    fontSize: '11px',
    color: '#fff',
    fontWeight: '500',
  },
  giftCost: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '10px',
    color: '#f8c64b',
    fontWeight: '700',
    marginTop: '2px',
  },
  giftCatalogStatus: {
    gridColumn: '1 / -1',
    padding: '24px 12px',
    textAlign: 'center',
    color: 'var(--text-secondary)',
    fontSize: '12px',
  },
  giftDockLoading: {
    padding: '14px 4px',
    textAlign: 'center',
    color: 'var(--text-secondary)',
    fontSize: '10px',
  },
  giftBanner: {
    position: 'absolute',
    top: '70px',
    left: '20px',
    right: '20px',
    backgroundColor: 'rgba(158, 60, 248, 0.85)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '16px',
    padding: '8px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 8px 25px rgba(158, 60, 248, 0.4)',
    animation: 'pulse-live 1.5s infinite ease-in-out',
    zIndex: 15,
  },
  giftVideoEffect: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
    zIndex: 11,
  },
  giftBannerIcon: {
    width: '54px',
    height: '54px',
    objectFit: 'contain',
  },
  giftBannerText: {
    fontSize: '12px',
    color: '#fff',
  },
  giftDock: {
    gridColumn: '3',
    gridRow: '1 / span 2',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 8px 10px',
    borderLeft: '1px solid var(--border-light)',
    backgroundColor: '#111113',
  },
  giftDockTitle: {
    color: '#fff',
    fontSize: '11px',
    fontWeight: 800,
    textTransform: 'uppercase',
    marginBottom: '8px',
  },
  giftDockList: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '7px',
  },
  giftDockButton: {
    width: '94px',
    minHeight: '96px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    backgroundColor: 'rgba(255,255,255,0.025)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#f8c64b',
  },
  giftDockImage: {
    width: '70px',
    height: '66px',
    objectFit: 'contain',
  },
  giftDockCost: {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    fontSize: '10px',
    fontWeight: 800,
  },
  giftDockMore: {
    width: '44px',
    height: '44px',
    marginTop: '8px',
    border: '1px solid rgba(255,56,129,0.4)',
    borderRadius: '50%',
    backgroundColor: '#ff3881',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  callOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    backdropFilter: 'blur(10px)',
  },
  callGlassBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--border-light)',
    borderRadius: '24px',
    padding: '30px 24px',
    width: '85%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  connectedCallBar: {
    position: 'absolute',
    left: '50%',
    bottom: '72px',
    transform: 'translateX(-50%)',
    zIndex: 30,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '8px',
    backgroundColor: 'rgba(12,12,16,0.82)',
    backdropFilter: 'blur(8px)',
  },
  pulseRing: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '90px',
    height: '90px',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 149, 255, 0.1)',
    marginBottom: '20px',
    boxShadow: '0 0 0 0 rgba(0, 149, 255, 0.5)',
    animation: 'button-pulse 2s infinite',
  },
  callAvatar: {
    width: '74px',
    height: '74px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #fff',
  },
  callTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '4px',
  },
  callSub: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    marginBottom: '20px',
  },
  callTimer: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: '4px 12px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  timerDot: {
    width: '8px',
    height: '8px',
    backgroundColor: 'var(--danger)',
    borderRadius: '50%',
    animation: 'pulse-live 1s infinite',
  },
  callCostAlert: {
    fontSize: '10px',
    color: 'var(--text-secondary)',
    marginBottom: '20px',
  },
  cancelCallBtn: {
    backgroundColor: 'var(--danger)',
    border: 'none',
    borderRadius: '14px',
    color: '#fff',
    padding: '12px 24px',
    fontSize: '13px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)',
  },
  hangupBtn: {
    backgroundColor: 'var(--danger)',
    border: 'none',
    borderRadius: '14px',
    color: '#fff',
    padding: '12px 24px',
    fontSize: '13px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)',
  },
  callActions: {
    display: 'flex',
    gap: '12px',
  },
  connectingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    zIndex: 5,
  },
  connectingSpinner: {
    width: '32px',
    height: '32px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTopColor: '#ff3881',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  connectingText: {
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    opacity: 0.8,
  },
};
