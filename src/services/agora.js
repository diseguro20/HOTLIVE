import AgoraRTC from 'agora-rtc-sdk-ng';

let compatibleCodecPromise = null;

export function getCompatibleAgoraCodec() {
  if (!compatibleCodecPromise) {
    compatibleCodecPromise = AgoraRTC.getSupportedCodec()
      .then(({ video }) => {
        const codecs = video.map((codec) => codec.toUpperCase());
        if (codecs.includes('VP8')) return 'vp8';
        if (codecs.includes('H264')) return 'h264';
        return 'vp8';
      })
      .catch(() => 'vp8');
  }

  return compatibleCodecPromise;
}
