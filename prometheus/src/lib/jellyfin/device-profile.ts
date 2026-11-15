import "server-only";

export type PrometheusPlaybackDevice = "browser";

export function createDeviceProfile(
  device: PrometheusPlaybackDevice,
) {
  if (device !== "browser") {
    throw new Error("Unsupported playback device.");
  }

  return {
    Name: "PROMETHEUS Browser",
    MaxStreamingBitrate: 8_000_000,
    MaxStaticBitrate: 8_000_000,

    DirectPlayProfiles: [
      {
        Type: "Video",
        Container: "mp4,m4v",
        VideoCodec: "h264",
        AudioCodec: "aac,mp3",
      },
    ],

    TranscodingProfiles: [
      {
        Type: "Video",
        Container: "ts",
        Protocol: "hls",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Context: "Streaming",
        MaxAudioChannels: "2",
        MinSegments: 1,
        SegmentLength: 6,
        BreakOnNonKeyFrames: false,
      },
    ],

    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [],
  };
}
