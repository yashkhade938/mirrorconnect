import type { YouTubeTrack } from "@/lib/youtube";

export type TrackSnapshotInput = Pick<
  YouTubeTrack,
  "videoId" | "title" | "artist" | "channelTitle" | "thumbnail" | "rawTitle"
>;

export function snapshotToDb(track: TrackSnapshotInput) {
  return {
    youtubeVideoId: track.videoId,
    title: track.title,
    artist: track.artist,
    channelTitle: track.channelTitle,
    thumbnail: track.thumbnail,
    rawTitle: track.rawTitle,
  };
}

export function snapshotFromDb(track: {
  youtubeVideoId: string;
  title: string;
  artist: string;
  channelTitle: string;
  thumbnail: string;
  rawTitle: string;
}) {
  return {
    videoId: track.youtubeVideoId,
    title: track.title,
    artist: track.artist,
    channelTitle: track.channelTitle,
    thumbnail: track.thumbnail,
    rawTitle: track.rawTitle,
    publishedAt: "",
  };
}
