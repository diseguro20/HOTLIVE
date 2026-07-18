// Let's generate UUID using simple JS crypto/random helper to avoid dependency issues!
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const API_BASE = "/api/web";

class SuperliveApi {
  constructor() {
    this.deviceId = localStorage.getItem('sl_device_id') || generateUUID();
    this.installId = localStorage.getItem('sl_install_id') || generateUUID();
    this.rtcId = localStorage.getItem('sl_rtc_id') || generateUUID();
    // Always get a fresh guid on startup - stale guids cause invalid Agora tokens
    this.guid = null;
    
    localStorage.setItem('sl_device_id', this.deviceId);
    localStorage.setItem('sl_install_id', this.installId);
    localStorage.setItem('sl_rtc_id', this.rtcId);

    this.agoraAppId = "dca16fbf522b4c6f96ecc88721800310"; // Default fallback
    this.wssUrl = "wss://ws.sy3sdcf1e39.link"; // Default fallback
    this.giftMediaBaseUrl = "https://cdn.sy3sdcf1e39.link/misc/gifts/";
    this.giftMetadataUrl = null;
    this.streamGiftIds = [];
    this.giftCatalog = null;
    this.giftCatalogPromise = null;
    this.isInitialized = false;
  }

  getClientParams() {
    return {
      "os_type": "web",
      "ad_nationality": null,
      "app_build": "5.10.2",
      "app": "superlive",
      "build_code": "1256-2973397-prod",
      "app_language": "pt",
      "device_language": "pt",
      "device_preferred_languages": ["pt-BR", "pt"],
      "source_url": "https://superlive.co/pt/discover",
      "session_source_url": "https://superlive.co/pt/discover",
      "referrer": "",
      "adid": null,
      "adjust_attribution_data": null,
      "adjust_web_uuid": null,
      "firebase_analytics_id": null,
      "incognito": null,
      "installation_id": this.installId,
      "rtc_id": this.rtcId,
      "ga_session_id": null,
      "web_type": 3,
      "native_attributes": null,
      "display_density": "1.25",
      "display_resolution_width": window.innerWidth || 1920,
      "display_resolution_height": window.innerHeight || 1080
    };
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'device-id': this.guid || this.deviceId,
      'Origin': 'https://superlive.co',
      'Referer': 'https://superlive.co/'
    };
  }

  async makeRequest(endpoint, body = {}) {
    const url = `${API_BASE}/${endpoint}`;
    const payload = {
      client_params: this.getClientParams(),
      ...body
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch {}
      throw new Error((errJson && errJson.error && errJson.error.message) || `HTTP error ${response.status}`);
    }

    return response.json();
  }

  async initApp() {
    try {
      // 1. Initialize
      console.log("Superlive API: Initializing device...");
      const initData = await this.makeRequest("initialize");
      if (initData && initData.guid) {
        this.guid = initData.guid;
        localStorage.setItem('sl_guid', this.guid);
      }

      // 2. Entry
      console.log("Superlive API: Sending entry...");
      await this.makeRequest("entry");

      // 3. Settings
      console.log("Superlive API: Fetching settings...");
      const settingsData = await this.makeRequest("settings");
      if (settingsData) {
        if (settingsData.agora_app_id) {
          this.agoraAppId = settingsData.agora_app_id;
        }
        if (settingsData.websocket && settingsData.websocket.url) {
          this.wssUrl = settingsData.websocket.url;
        }
        const giftSettings = settingsData.gift_settings || {};
        this.giftMediaBaseUrl = giftSettings.gift_media_base_url || this.giftMediaBaseUrl;
        this.giftMetadataUrl = giftSettings.gift_metadata_url || null;
        this.streamGiftIds = giftSettings.gift_listings?.stream_gift || [];
      }

      this.isInitialized = true;
      console.log("Superlive API: Ready!");
    } catch (e) {
      console.error("Superlive API initialization failed:", e);
      throw e;
    }
  }

  async fetchDiscover(sectionType) {
    // sectionType: 0 = Popular, 1 = Countries, 6 = Video call, etc.
    const res = await this.makeRequest("discover", {
      next: null,
      type: sectionType
    });
    return res.items || [];
  }

  async retrieveStreamer(livestreamId) {
    return this.makeRequest("livestream/retrieve", {
      livestream_id: Number(livestreamId)
    });
  }

  async retrieveUserProfile(userId) {
    return this.makeRequest("users/profile", {
      user_id: String(userId)
    });
  }

  async fetchGiftCatalog() {
    if (this.giftCatalog) return this.giftCatalog;
    if (this.giftCatalogPromise) return this.giftCatalogPromise;
    if (!this.giftMetadataUrl) return [];

    this.giftCatalogPromise = fetch(this.giftMetadataUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Gift catalog HTTP ${response.status}`);
        return response.json();
      })
      .then((metadata) => {
        const byId = new Map(metadata.map((gift) => [Number(gift.gift_id), gift]));
        const orderedMetadata = this.streamGiftIds.length
          ? this.streamGiftIds.map((id) => byId.get(Number(id))).filter(Boolean)
          : metadata;

        this.giftCatalog = orderedMetadata.map((gift) => {
          const preferredVideo = gift.videos?.find((video) => Number(video.width) === 960)
            || gift.videos?.find((video) => Number(video.width) === 720)
            || gift.videos?.[0];
          const resolveMedia = (path) => path
            ? new URL(path, this.giftMediaBaseUrl).toString()
            : null;

          return {
            id: String(gift.gift_id),
            giftId: Number(gift.gift_id),
            name: gift.name || `Presente ${gift.gift_id}`,
            image: resolveMedia(gift.image),
            cost: Number(gift.cost || 0),
            diamond: Number(gift.diamond || 0),
            type: Number(gift.type || 0),
            category: Number(gift.category || 0),
            vipRequired: Number(gift.vip_state_required || 0),
            videoUrl: resolveMedia(preferredVideo?.url || gift.video_url),
            animationUrl: resolveMedia(gift.animation_url),
            animationDuration: Number(gift.animation_duration || 2500),
          };
        });
        return this.giftCatalog;
      })
      .catch((error) => {
        this.giftCatalogPromise = null;
        throw error;
      });

    return this.giftCatalogPromise;
  }

  async startPrivateVideoCall(calleeId) {
    return this.makeRequest("private_call/start", {
      callee_id: String(calleeId),
      callee_pays: false,
      call_type: 1,
      gift_id: null
    });
  }

  async retrievePrivateCall(privateCallId) {
    return this.makeRequest("private_call/retrieve", {
      private_call_id: Number(privateCallId)
    });
  }

  async cancelPrivateCall(privateCallId) {
    return this.makeRequest("private_call/cancel", {
      private_call_id: Number(privateCallId)
    });
  }

  async endPrivateCall(privateCallId) {
    return this.makeRequest("private_call/end", {
      private_call_id: Number(privateCallId)
    });
  }
}

const api = new SuperliveApi();
export default api;
