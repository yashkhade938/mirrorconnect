export type YouTubeTrack = {
  videoId: string;
  title: string;
  rawTitle: string;
  artist: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
  duration?: string;
  description?: string;
  cachedAt?: string;
};

const titleNoisePatterns = [
  /\[(?:official\s*)?(?:music\s*)?video\]/gi,
  /\((?:official\s*)?(?:music\s*)?video\)/gi,
  /\[(?:official\s*)?lyrics?\]/gi,
  /\((?:official\s*)?lyrics?\)/gi,
  /\[(?:official\s*)?audio\]/gi,
  /\((?:official\s*)?audio\)/gi,
  /\[(?:visualizer|mv|hd|4k|8k)\]/gi,
  /\((?:visualizer|mv|hd|4k|8k)\)/gi,
  /\s*\|\s*(?:official\s*)?(?:music\s*)?(?:video|audio|lyrics?).*$/gi,
  /\s*-\s*(?:official\s*)?(?:music\s*)?(?:video|audio|lyrics?).*$/gi,
  /\s+(?:official\s*)?(?:music\s*)?(?:video|audio|lyrics?)\s*$/gi,
  /\s+(?:ft\.?|feat\.?|featuring)\s+[^-()[\]|]+/gi,
];

const entityMap: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function cleanTitle(rawTitle: string) {
  const decoded = rawTitle.replace(
    /&(?:amp|quot|apos);|&#39;/g,
    (entity) => entityMap[entity] ?? entity,
  );

  return titleNoisePatterns
    .reduce((title, pattern) => title.replace(pattern, ""), decoded)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([:|/,-])\s+/g, " $1 ")
    .replace(/^[\s"'`-]+|[\s"'`-]+$/g, "")
    .trim();
}

export function inferArtist(rawTitle: string, channelTitle: string) {
  const dashMatch = rawTitle.match(/^(.+?)\s+-\s+(.+)$/);

  if (dashMatch?.[1]) {
    return cleanTitle(dashMatch[1]).replace(/\s+-\s+$/, "").trim();
  }

  return channelTitle
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .replace(/\s+Official$/i, "")
    .trim();
}
