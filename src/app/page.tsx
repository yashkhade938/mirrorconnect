"use client";

import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Library,
  ListMusic,
  Loader2,
  Maximize2,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
} from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { YouTubeTrack } from "@/lib/youtube";

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __mixtapeYouTubeReadyCallbacks?: Array<() => void>;
    __mixtapeSeekTo?: (seconds: number) => void;
  }
}

type YouTubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width: number;
      height: number;
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
  };
};

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  cueVideoById: (videoId: string) => void;
  loadVideoById: (videoId: string) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

type SearchResponse = {
  query: string;
  cached: boolean;
  results: YouTubeTrack[];
  stale?: boolean;
  error?: string;
  details?: string;
  quotaExceeded?: boolean;
};

type SearchSuggestion = {
  query: string;
  normalizedQuery: string;
  searchCount: number;
};

type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

type PlaylistSummary = {
  id: string;
  name: string;
  description: string | null;
  tracks: YouTubeTrack[];
};

type ImportedTrack = {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  position: number;
  matchedYoutubeVideoId: string | null;
};

type ImportedPlaylistSummary = {
  id: string;
  name: string;
  source: string;
  sourceUrl: string;
  totalTracks: number;
  tracks: ImportedTrack[];
};

type LyricsState = {
  provider: string;
  title: string;
  artist: string;
  lyrics: string | null;
  url: string | null;
  message: string;
};

const navigation = [
  { label: "Home", icon: Library },
  { label: "Search", icon: Search },
  { label: "Radio", icon: Radio },
  { label: "Library", icon: ListMusic },
];

const starterQueries = ["new music", "indie pop", "r&b hits", "electronic chill"];

export default function Home() {
  const [activeNav, setActiveNav] = useState("Home");
  const [query, setQuery] = useState("new music");
  const [lastQuery, setLastQuery] = useState("new music");
  const [tracks, setTracks] = useState<YouTubeTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<YouTubeTrack | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [likedSongs, setLikedSongs] = useState<YouTubeTrack[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<YouTubeTrack[]>([]);
  const [recommendations, setRecommendations] = useState<YouTubeTrack[]>([]);
  const [importedPlaylists, setImportedPlaylists] = useState<ImportedPlaylistSummary[]>([]);
  const [isImportedLoading, setIsImportedLoading] = useState(false);
  const [recommendationReason, setRecommendationReason] = useState("Fresh music picks");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(new Set());
  const [volume, setVolume] = useState(68);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [trendingSearches, setTrendingSearches] = useState<SearchSuggestion[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchCacheRef = useRef<Map<string, SearchResponse>>(new Map());
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<number | null>(null);
  const inFlightSearchRef = useRef<string | null>(null);

  const currentIndex = useMemo(
    () =>
      currentTrack
        ? tracks.findIndex((track) => track.videoId === currentTrack.videoId)
        : -1,
    [currentTrack, tracks],
  );

  const heroTrack = currentTrack ?? tracks[0] ?? null;
  const isLiked = currentTrack ? likedVideoIds.has(currentTrack.videoId) : false;
  const quickSearches = trendingSearches.length ? trendingSearches : starterQueries.map((item) => ({
    query: item,
    normalizedQuery: item,
    searchCount: 0,
  }));

  const refreshLibrary = async () => {
    setIsLibraryLoading(true);

    try {
      const [likesResponse, historyResponse, playlistsResponse] = await Promise.all([
        fetch("/api/library/likes"),
        fetch("/api/library/history"),
        fetch("/api/library/playlists"),
      ]);

      if (likesResponse.status === 401) {
        setLikedSongs([]);
        setRecentlyPlayed([]);
        setPlaylists([]);
        setLikedVideoIds(new Set());
        return;
      }

      const likesPayload = (await likesResponse.json()) as { likes?: YouTubeTrack[] };
      const historyPayload = (await historyResponse.json()) as { history?: YouTubeTrack[] };
      const playlistsPayload = (await playlistsResponse.json()) as { playlists?: PlaylistSummary[] };
      const nextLikedSongs = likesPayload.likes ?? [];

      setLikedSongs(nextLikedSongs);
      setRecentlyPlayed(historyPayload.history ?? []);
      setPlaylists(playlistsPayload.playlists ?? []);
      setLikedVideoIds(new Set(nextLikedSongs.map((track) => track.videoId)));
    } finally {
      setIsLibraryLoading(false);
    }
  };

  const refreshSession = async () => {
    const response = await fetch("/api/auth/session");
    const payload = (await response.json()) as { user: SessionUser | null };

    setSessionUser(payload.user);

    if (payload.user) {
      await refreshLibrary();
    }
  };

  const login = async () => {
    const response = await fetch("/api/auth/dev-login", {
      method: "POST",
    });
    const payload = (await response.json()) as { user: SessionUser };

    setSessionUser(payload.user);
    setMessage("Signed in with the local demo account.");
    await refreshLibrary();

    return payload.user;
  };

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
    });
    setSessionUser(null);
    setLikedSongs([]);
    setRecentlyPlayed([]);
    setPlaylists([]);
    setLikedVideoIds(new Set());
    setMessage("Signed out.");
  };

  const ensureSignedIn = async () => {
    if (sessionUser) {
      return sessionUser;
    }

    setMessage("Signing in with the demo account...");
    return login();
  };

  const createPlaylist = async () => {
    await ensureSignedIn();

    const response = await fetch("/api/library/playlists", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `Playlist ${playlists.length + 1}` }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Could not create playlist.");
    }

    await refreshLibrary();
    setMessage("Playlist created.");
  };

  const addTrackToFirstPlaylist = async (track: YouTubeTrack) => {
    await ensureSignedIn();

    let targetPlaylist = playlists[0] ?? null;

    if (!targetPlaylist) {
      const response = await fetch("/api/library/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "My Playlist" }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Could not create playlist.");
      }

      const payload = (await response.json()) as { playlist: PlaylistSummary };
      targetPlaylist = {
        ...payload.playlist,
        tracks: [],
      };
      await refreshLibrary();
    }

    const response = await fetch(`/api/library/playlists/${targetPlaylist.id}/tracks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ track }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Could not add track to playlist.");
    }

    await refreshLibrary();
    setMessage(`Added to ${targetPlaylist.name}.`);
  };

  const refreshImportedPlaylists = async () => {
    setIsImportedLoading(true);

    try {
      const response = await fetch("/api/imported-playlists?take=40");
      const payload = (await response.json()) as { playlists?: ImportedPlaylistSummary[] };

      setImportedPlaylists(payload.playlists ?? []);
    } finally {
      setIsImportedLoading(false);
    }
  };

  const applySearchResults = (
    searchQuery: string,
    payload: SearchResponse,
    source: "client-cache" | "server-cache" | "youtube",
  ) => {
    setTracks(payload.results);
    setCurrentTrack(payload.results[0] ?? null);
    setIsPlaying(false);
    setLastQuery(searchQuery);
    setStatus("idle");
    setMessage(
      payload.results.length
        ? source === "client-cache"
          ? "Loaded instantly from local search cache."
          : source === "server-cache"
            ? payload.stale
              ? "Loaded an older cached result because YouTube is unavailable."
              : "Loaded from search cache."
            : "Loaded fresh from YouTube."
        : "No results found.",
    );
  };

  const runSearch = async (
    searchQuery: string,
    options: {
      forceYouTube?: boolean;
    } = {},
  ) => {
    const trimmed = searchQuery.replace(/\s+/g, " ").trim();
    const cacheKey = trimmed.toLowerCase();
    const requestKey = options.forceYouTube ? `${cacheKey}:youtube` : cacheKey;

    if (!trimmed) {
      return;
    }

    if (inFlightSearchRef.current === requestKey) {
      setMessage("That search is already running.");
      return;
    }

    const cached = searchCacheRef.current.get(cacheKey);

    if (cached && !options.forceYouTube) {
      applySearchResults(trimmed, cached, "client-cache");
      return cached;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    inFlightSearchRef.current = requestKey;
    setStatus("loading");
    setMessage("");

    try {
      const params = new URLSearchParams({
        q: trimmed,
        maxResults: "12",
      });

      if (options.forceYouTube) {
        params.set("source", "youtube");
      }

      const response = await fetch(
        `/api/search?${params.toString()}`,
        {
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as SearchResponse;

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Search is cooling down for a moment. Try again in about a minute.");
        }

        if (
          payload.quotaExceeded ||
          payload.details?.includes("quotaExceeded") ||
          payload.details?.includes("rateLimitExceeded") ||
          payload.details?.includes("RESOURCE_EXHAUSTED") ||
          payload.details?.includes("Search Queries per day")
        ) {
          throw new Error("YouTube search quota is exhausted for today. Try cached searches or come back tomorrow.");
        }

        throw new Error(payload.error ?? "Search failed.");
      }

      if (!options.forceYouTube || payload.cached) {
        searchCacheRef.current.set(cacheKey, payload);
      }
      applySearchResults(trimmed, payload, payload.cached ? "server-cache" : "youtube");
      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Search failed.");
      return undefined;
    } finally {
      if (inFlightSearchRef.current === requestKey) {
        inFlightSearchRef.current = null;
      }

      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
    }
  };

  const playImportedTrack = async (track: ImportedTrack) => {
    const searchText = `${track.title} ${track.artist}`;

    if (track.matchedYoutubeVideoId) {
      const response = await fetch(`/api/imported-tracks/${encodeURIComponent(track.id)}/match`);

      if (response.ok) {
        const payload = (await response.json()) as { track?: YouTubeTrack };

        if (payload.track) {
          selectTrack(payload.track);
          setMessage(`Loaded ${track.title} from saved Apple Music match.`);
          return;
        }
      }
    }

    setQuery(searchText);
    setMessage(`Matching ${track.title} to a playable YouTube track...`);

    const payload = await runSearch(searchText, { forceYouTube: true });
    const matchedTrack = payload?.results[0];

    if (!matchedTrack) {
      setMessage(`Could not find a playable YouTube match for ${track.title}.`);
      return;
    }

    await fetch(`/api/imported-tracks/${encodeURIComponent(track.id)}/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ track: matchedTrack }),
    }).catch(() => undefined);
    setImportedPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map((item) =>
          item.id === track.id
            ? {
                ...item,
                matchedYoutubeVideoId: matchedTrack.videoId,
              }
            : item,
        ),
      })),
    );
    selectTrack(matchedTrack);
  };

  const scheduleSearch = (searchQuery: string) => {
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = window.setTimeout(() => {
      void runSearch(searchQuery);
    }, 700);
  };

  const cancelPendingSearch = () => {
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshSession();
      void refreshImportedPlaylists();
      scheduleSearch("new music");
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      cancelPendingSearch();
      searchAbortRef.current?.abort();
    };
    // Run once on mount to bootstrap session and default search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const timeout = window.setTimeout(async () => {
      const trimmed = query.replace(/\s+/g, " ").trim();

      if (!trimmed) {
        setSuggestions([]);
        return;
      }

      try {
        const response = await fetch(
          `/api/search/suggestions?q=${encodeURIComponent(trimmed)}&take=6`,
          {
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as { suggestions?: SearchSuggestion[] };

        setSuggestions(payload.suggestions ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();

    const loadTrendingSearches = async () => {
      try {
        const response = await fetch("/api/search/trending?take=4", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { searches?: SearchSuggestion[] };

        setTrendingSearches(payload.searches ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setTrendingSearches([]);
        }
      }
    };

    void loadTrendingSearches();

    return () => {
      controller.abort();
    };
  }, [lastQuery]);

  useEffect(() => {
    if (!currentTrack) {
      return;
    }

    const controller = new AbortController();

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/recommendations?videoId=${encodeURIComponent(currentTrack.videoId)}&artist=${encodeURIComponent(currentTrack.artist)}`,
          {
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as { reason?: string; results?: YouTubeTrack[] };

        setRecommendationReason(payload.reason ?? "Fresh music picks");
        setRecommendations(payload.results ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setRecommendations([]);
          setRecommendationReason("Fresh music picks");
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [currentTrack]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    scheduleSearch(query);
  };

  const selectTrack = (track: YouTubeTrack, shouldPlay = true) => {
    setCurrentTrack(track);
    setIsPlaying(shouldPlay);
    setIsBuffering(shouldPlay);
    setCurrentTime(0);
    setDuration(0);

    if (sessionUser && shouldPlay) {
      void fetch("/api/library/history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ track }),
      }).then(() => refreshLibrary());
    }
  };

  const selectNextTrack = () => {
    if (!tracks.length) {
      return;
    }

    const next = tracks[(Math.max(currentIndex, 0) + 1) % tracks.length];
    selectTrack(next);
  };

  const selectPreviousTrack = () => {
    if (!tracks.length) {
      return;
    }

    const previous =
      tracks[(Math.max(currentIndex, 0) - 1 + tracks.length) % tracks.length];
    selectTrack(previous);
  };

  const toggleLike = async (track = currentTrack) => {
    if (!track) {
      return;
    }

    const wasLiked = likedVideoIds.has(track.videoId);

    try {
      await ensureSignedIn();

      setLikedVideoIds((current) => {
        const next = new Set(current);

        if (next.has(track.videoId)) {
          next.delete(track.videoId);
        } else {
          next.add(track.videoId);
        }

        return next;
      });

      const response = await fetch("/api/library/likes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ track }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Could not update liked songs.");
      }

      await refreshLibrary();
      setMessage(wasLiked ? "Removed from liked songs." : "Added to liked songs.");
    } catch (error) {
      setLikedVideoIds((current) => {
        const next = new Set(current);

        if (wasLiked) {
          next.add(track.videoId);
        } else {
          next.delete(track.videoId);
        }

        return next;
      });
      setMessage(error instanceof Error ? error.message : "Could not update liked songs.");
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (currentTrack) {
          setIsPlaying((value) => !value);
        }
      }

      if (event.code === "ArrowRight") {
        selectNextTrack();
      }

      if (event.code === "ArrowLeft") {
        selectPreviousTrack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const accent = heroTrack ? "#fb5c74" : "#2dd4bf";

  return (
    <main className="min-h-screen overflow-hidden bg-[#090909] text-white">
      <div
        className="pointer-events-none fixed inset-0 opacity-30"
        style={{
          background: `radial-gradient(circle at 66% 14%, ${accent}55, transparent 30%), radial-gradient(circle at 18% 74%, #22d3ee33, transparent 28%)`,
        }}
      />

      <aside data-testid="desktop-sidebar" className="fixed left-0 top-0 z-30 hidden h-screen w-60 border-r border-white/10 bg-black/55 px-4 py-5 backdrop-blur-2xl lg:block">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#fa233b] to-[#fb5c74] shadow-lg shadow-[#fa233b]/30">
            <ListMusic size={20} fill="white" />
          </div>
          <div>
            <p className="text-lg font-bold leading-tight">Mixtape</p>
            <p className="text-xs text-[#a1a1a6]">YouTube powered</p>
          </div>
        </div>

        <nav className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.label;

            return (
              <button
                key={item.label}
                onClick={() => setActiveNav(item.label)}
                className={`flex h-11 w-full items-center gap-3 rounded-full px-4 text-sm font-medium transition-all duration-300 ${
                  isActive
                    ? "bg-gradient-to-r from-[#fa233b] to-[#fb5c74] text-white shadow-lg shadow-[#fa233b]/20"
                    : "text-[#a1a1a6] hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-9 border-t border-white/10 pt-6">
          <div className="mb-3 flex items-center justify-between px-2">
            <p className="text-xs font-bold uppercase text-[#a1a1a6]">Playlists</p>
            <button
              onClick={async () => {
                try {
                  await createPlaylist();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Could not create playlist.");
                }
              }}
              className="grid h-7 w-7 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="space-y-1">
            {[
              { id: "liked", name: "Liked Songs" },
              ...playlists.map((playlist) => ({ id: playlist.id, name: playlist.name })),
            ].map((playlist) => (
              <button
                key={playlist.id}
                className="block h-9 w-full truncate rounded-full px-3 text-left text-sm text-[#d4d4d8] transition hover:bg-white/10 hover:text-white"
              >
                {playlist.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="relative z-10 min-h-screen pb-64 md:pb-36 lg:ml-60">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between gap-4 border-b border-white/10 bg-black/40 px-5 backdrop-blur-2xl md:px-8">
          <div className="hidden items-center gap-3 md:flex">
            <button className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20">
              <ChevronLeft size={18} />
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20">
              <ChevronRight size={18} />
            </button>
          </div>
          <form onSubmit={handleSearch} className="relative w-full max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#a1a1a6]" size={18} />
            <input
              aria-label="Search YouTube music"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setIsSearchFocused(false), 120);
              }}
              className="h-11 w-full rounded-full border border-white/10 bg-white/10 pl-11 pr-24 text-sm text-white outline-none transition placeholder:text-[#a1a1a6] focus:border-[#fb5c74]/60 focus:bg-white/15"
              placeholder="Search songs, videos, artists"
            />
            <button className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-full bg-white px-4 text-xs font-bold text-black transition hover:bg-zinc-200">
              Search
            </button>
            {isSearchFocused && suggestions.length ? (
              <div className="absolute left-0 right-0 top-[52px] z-30 overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c1e]/95 py-2 shadow-2xl shadow-black/50 backdrop-blur-2xl">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.normalizedQuery}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setQuery(suggestion.query);
                      setSuggestions([]);
                      setIsSearchFocused(false);
                      scheduleSearch(suggestion.query);
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-4 px-4 text-left text-sm text-white transition hover:bg-white/10"
                  >
                    <span className="truncate">{suggestion.query}</span>
                    <span className="shrink-0 text-xs text-[#a1a1a6]">
                      {suggestion.searchCount ? `${suggestion.searchCount} searches` : "cached"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </form>
          <button
            onClick={() => {
              void (sessionUser ? logout() : login());
            }}
            className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-zinc-200 md:px-5 md:text-sm"
          >
            {sessionUser ? "Sign Out" : "Sign In"}
          </button>
        </header>

        <div className="mx-auto box-border w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <section className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div data-testid="browse-hero" className="relative min-w-0 min-h-[360px] overflow-hidden rounded-[24px] bg-[#161616] p-5 shadow-2xl md:rounded-[28px] md:p-8">
              {heroTrack ? (
                <Image
                  src={heroTrack.thumbnail}
                  alt=""
                  fill
                  sizes="(min-width: 1280px) 860px, 100vw"
                  className="absolute inset-0 scale-110 object-cover opacity-30 blur-2xl"
                  priority
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/20" />
              <div className="relative flex h-full flex-col justify-between gap-8 md:flex-row md:items-end">
                <div className="min-w-0 max-w-2xl">
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase text-white backdrop-blur-xl">
                    {status === "loading" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    Real YouTube Search
                  </div>
                  <h1 className="line-clamp-3 max-w-2xl break-words text-4xl font-bold leading-none md:text-5xl xl:text-7xl">
                    {heroTrack ? heroTrack.title : "Search for a song."}
                  </h1>
                  <p className="mt-5 line-clamp-2 max-w-xl break-words text-base leading-7 text-[#d4d4d8] md:text-lg">
                    {heroTrack
                      ? `${heroTrack.artist} · ${heroTrack.channelTitle}`
                      : "Add your YouTube Data API key in .env, then search any artist or track."}
                  </p>
                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <button
                      disabled={!heroTrack}
                      onClick={() => {
                        if (heroTrack) {
                          selectTrack(heroTrack, !isPlaying || heroTrack.videoId !== currentTrack?.videoId);
                        }
                      }}
                      className="inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-[#fa233b] to-[#fb5c74] px-6 text-sm font-bold shadow-lg shadow-[#fa233b]/30 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isBuffering ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : isPlaying ? (
                        <Pause size={18} fill="white" />
                      ) : (
                        <Play size={18} fill="white" />
                      )}
                      {isPlaying ? "Pause" : "Play"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!heroTrack) {
                          return;
                        }

                        try {
                          await addTrackToFirstPlaylist(heroTrack);
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : "Could not add track to playlist.");
                        }
                      }}
                      className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white backdrop-blur-xl transition hover:bg-white/20"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                  {message ? (
                    <p
                      className={`mt-5 text-sm ${
                        status === "error" ? "text-[#fb5c74]" : "text-[#a1a1a6]"
                      }`}
                    >
                      {message}
                    </p>
                  ) : null}
                </div>

                {heroTrack ? (
                  <div className="w-full max-w-[260px] shrink-0">
                    <Image
                      src={heroTrack.thumbnail}
                      alt={`${heroTrack.title} cover`}
                      width={520}
                      height={520}
                      className="aspect-square w-full max-w-[220px] rounded-2xl object-cover shadow-2xl shadow-black/60 md:max-w-none"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div data-testid="queue-panel" className="min-w-0 rounded-[28px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-2xl">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Up Next</h2>
                  <p className="text-sm text-[#a1a1a6]">Queue from YouTube results</p>
                </div>
                <button className="grid h-9 w-9 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white">
                  <Shuffle size={18} />
                </button>
              </div>
              <div className="space-y-2">
                {tracks.slice(currentIndex + 1, currentIndex + 5).map((track) => (
                  <TrackQueueButton
                    key={track.videoId}
                    track={track}
                    onClick={() => selectTrack(track)}
                  />
                ))}
                {!tracks.length && (
                  <p className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-[#a1a1a6]">
                    Search results will appear here after `/api/search` returns data.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="mt-10">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold">Results For {lastQuery}</h2>
                <p className="mt-1 text-sm text-[#a1a1a6]">
                  Real videos filtered to YouTube music category
                </p>
              </div>
              <div className="hidden gap-2 md:flex">
                {quickSearches.map((item) => (
                  <button
                    key={item.normalizedQuery}
                    onClick={() => {
                      setQuery(item.query);
                      scheduleSearch(item.query);
                    }}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/20"
                  >
                    {item.query}
                  </button>
                ))}
              </div>
            </div>
            <div data-testid="results-carousel" className="flex snap-x gap-5 overflow-x-auto pb-4 [scrollbar-width:none]">
              {status === "loading"
                ? Array.from({ length: 6 }).map((_, index) => (
                    <SkeletonCard key={index} />
                  ))
                : null}
              {tracks.map((track) => (
                <article key={track.videoId} className="group w-44 shrink-0 snap-start md:w-52">
                  <div className="relative overflow-hidden rounded-2xl bg-white/10 shadow-lg shadow-black/30">
                    <Image
                      src={track.thumbnail}
                      alt={`${track.title} artwork`}
                      width={420}
                      height={420}
                      className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <button
                      onClick={() => selectTrack(track)}
                      className="absolute inset-0 m-auto grid h-14 w-14 scale-90 place-items-center rounded-full bg-gradient-to-br from-[#fa233b] to-[#fb5c74] opacity-0 shadow-xl shadow-black/40 transition duration-300 group-hover:scale-100 group-hover:opacity-100"
                    >
                      <Play size={22} fill="white" />
                    </button>
                  </div>
                  <h3 className="mt-3 truncate text-sm font-bold md:text-base">{track.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-[#a1a1a6]">{track.artist}</p>
                </article>
              ))}
            </div>
          </section>

          <PersonalShelf
            title="Recently Played"
            subtitle={sessionUser ? "Saved from your listening history" : "Sign in to build listening history"}
            tracks={recentlyPlayed}
            loading={isLibraryLoading}
            onSelect={selectTrack}
          />

          <PersonalShelf
            title="Liked Songs"
            subtitle={sessionUser ? "Your automatic liked-songs playlist" : "Sign in to save liked songs"}
            tracks={likedSongs}
            loading={isLibraryLoading}
            onSelect={selectTrack}
          />

          <PersonalShelf
            title="Recommended"
            subtitle={recommendationReason}
            tracks={recommendations}
            loading={Boolean(currentTrack && !recommendations.length)}
            onSelect={selectTrack}
          />

          <ImportedShelf
            playlist={importedPlaylists[0] ?? null}
            loading={isImportedLoading}
            onSelect={(track) => {
              void playImportedTrack(track);
            }}
          />

          <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-2xl md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold">Library</h2>
                <p className="truncate text-sm text-[#a1a1a6]">
                  {sessionUser ? `${playlists.length} playlists saved` : "Demo sign-in saves likes and playlists"}
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await createPlaylist();
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Could not create playlist.");
                  }
                }}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black transition hover:bg-zinc-200"
              >
                <Plus size={16} />
                Playlist
              </button>
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold">Track List</h2>
                <p className="mt-1 text-sm text-[#a1a1a6]">
                  Cleaned titles, channel metadata, and embeddable video IDs
                </p>
              </div>
            </div>
            <div data-testid="track-list" className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl">
              {tracks.map((track, index) => {
                const selected = track.videoId === currentTrack?.videoId;

                return (
                  <button
                    key={track.videoId}
                    onClick={() => selectTrack(track)}
                    className={`group grid w-full grid-cols-[34px_1fr_auto_auto] items-center gap-3 border-b border-white/10 px-4 py-3 text-left transition last:border-b-0 md:grid-cols-[42px_1.3fr_1fr_74px_44px_44px] ${
                      selected ? "bg-white/10" : "hover:bg-white/[0.07]"
                    }`}
                  >
                    <span className="grid h-8 w-8 place-items-center text-sm text-[#a1a1a6]">
                      <span className="group-hover:hidden">{index + 1}</span>
                      <Play className="hidden group-hover:block" size={16} fill="white" />
                    </span>
                    <span className="flex min-w-0 items-center gap-3">
                      <Image
                        src={track.thumbnail}
                        alt=""
                        width={96}
                        height={96}
                        className="h-12 w-12 rounded-lg object-cover"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{track.title}</span>
                        <span className="block truncate text-sm text-[#a1a1a6]">{track.artist}</span>
                      </span>
                    </span>
                    <span className="hidden truncate text-sm text-[#a1a1a6] md:block">
                      {track.channelTitle}
                    </span>
                    <span className="text-sm text-[#a1a1a6]">
                      {selected && isBuffering ? "Loading" : formatTime(duration)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Add track to playlist"
                      onClick={(event) => {
                        event.stopPropagation();
                        void addTrackToFirstPlaylist(track).catch((error) => {
                          setMessage(error instanceof Error ? error.message : "Could not add track to playlist.");
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void addTrackToFirstPlaylist(track).catch((error) => {
                            setMessage(error instanceof Error ? error.message : "Could not add track to playlist.");
                          });
                        }
                      }}
                      className="grid h-11 w-11 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white"
                    >
                      <Plus size={18} />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={likedVideoIds.has(track.videoId) ? "Unlike track" : "Like track"}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleLike(track);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void toggleLike(track);
                        }
                      }}
                      className="grid h-11 w-11 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white"
                    >
                      <Heart
                        size={18}
                        className={likedVideoIds.has(track.videoId) ? "text-[#fb5c74]" : ""}
                        fill={likedVideoIds.has(track.videoId) ? "#fb5c74" : "none"}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </section>

      <YouTubeHiddenPlayer
        track={currentTrack}
        isPlaying={isPlaying}
        volume={volume}
        onEnded={selectNextTrack}
        onPlaybackError={(reason) => {
          setIsBuffering(false);
          setIsPlaying(false);
          setMessage(reason);
          window.setTimeout(() => {
            selectNextTrack();
          }, 700);
        }}
        onBufferingChange={setIsBuffering}
        onPlaybackChange={setIsPlaying}
        onProgressChange={(time, total) => {
          setCurrentTime(time);
          setDuration(total);
        }}
      />

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        liked={isLiked}
        volume={volume}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={() => currentTrack && setIsPlaying((value) => !value)}
        onPrevious={selectPreviousTrack}
        onNext={selectNextTrack}
        onToggleLike={toggleLike}
        onVolumeChange={setVolume}
        onSeek={(seconds) => setCurrentTime(seconds)}
        onOpenNowPlaying={() => currentTrack && setIsNowPlayingOpen(true)}
      />

      {isNowPlayingOpen && currentTrack ? (
        <NowPlayingOverlay
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          liked={isLiked}
          currentTime={currentTime}
          duration={duration}
          onClose={() => setIsNowPlayingOpen(false)}
          onTogglePlay={() => setIsPlaying((value) => !value)}
          onToggleLike={toggleLike}
          onNext={selectNextTrack}
          onPrevious={selectPreviousTrack}
        />
      ) : null}

      {!isNowPlayingOpen ? <MobileTabBar activeNav={activeNav} onChange={setActiveNav} /> : null}
    </main>
  );
}

function TrackQueueButton({
  track,
  onClick,
}: {
  track: YouTubeTrack;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-white/10"
    >
      <Image src={track.thumbnail} alt="" width={96} height={96} className="h-12 w-12 rounded-lg object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{track.title}</span>
        <span className="block truncate text-xs text-[#a1a1a6]">{track.artist}</span>
      </span>
      <Play size={16} className="text-[#a1a1a6] opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

function PersonalShelf({
  title,
  subtitle,
  tracks,
  loading,
  onSelect,
}: {
  title: string;
  subtitle: string;
  tracks: YouTubeTrack[];
  loading: boolean;
  onSelect: (track: YouTubeTrack) => void;
}) {
  return (
    <section className="mt-8">
      <div className="mb-5">
        <h2 className="text-3xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-[#a1a1a6]">{subtitle}</p>
      </div>
      <div data-testid="personal-shelf-carousel" className="flex snap-x gap-5 overflow-x-auto pb-4 [scrollbar-width:none]">
        {loading && !tracks.length
          ? Array.from({ length: 5 }).map((_, index) => <SkeletonCard key={index} />)
          : null}
        {!loading && !tracks.length ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-[#a1a1a6]">
            Nothing here yet.
          </div>
        ) : null}
        {tracks.map((track, index) => (
          <article key={`${title}-${track.videoId}-${index}`} className="group w-40 shrink-0 snap-start md:w-48">
            <div className="relative overflow-hidden rounded-2xl bg-white/10 shadow-lg shadow-black/30">
              <Image
                src={track.thumbnail}
                alt={`${track.title} artwork`}
                width={384}
                height={384}
                className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <button
                onClick={() => onSelect(track)}
                className="absolute inset-0 m-auto grid h-12 w-12 scale-90 place-items-center rounded-full bg-gradient-to-br from-[#fa233b] to-[#fb5c74] opacity-0 shadow-xl shadow-black/40 transition duration-300 group-hover:scale-100 group-hover:opacity-100"
              >
                <Play size={20} fill="white" />
              </button>
            </div>
            <h3 className="mt-1 truncate text-sm font-bold">{track.title}</h3>
            <p className="mt-1 truncate text-sm text-[#a1a1a6]">{track.artist}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ImportedShelf({
  playlist,
  loading,
  onSelect,
}: {
  playlist: ImportedPlaylistSummary | null;
  loading: boolean;
  onSelect: (track: ImportedTrack) => void;
}) {
  const tracks = playlist?.tracks ?? [];

  return (
    <section className="mt-8">
      <div className="mb-5">
        <h2 className="text-3xl font-bold">{playlist?.name ?? "Imported Songs"}</h2>
        <p className="mt-1 text-sm text-[#a1a1a6]">
          {playlist
            ? `${playlist.totalTracks} songs imported from SongShift. Matched songs play instantly; new songs match once and save.`
            : "SongShift imports will appear here."}
        </p>
      </div>
      <div data-testid="imported-shelf-carousel" className="flex snap-x gap-5 overflow-x-auto pb-4 [scrollbar-width:none]">
        {loading && !tracks.length
          ? Array.from({ length: 5 }).map((_, index) => <SkeletonCard key={index} />)
          : null}
        {!loading && !tracks.length ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-[#a1a1a6]">
            Nothing imported yet.
          </div>
        ) : null}
        {tracks.map((track) => (
          <article key={track.id} className="group w-40 shrink-0 snap-start md:w-48">
            <div className="relative overflow-hidden rounded-2xl bg-white/10 shadow-lg shadow-black/30">
              {track.artworkUrl ? (
                <Image
                  src={track.artworkUrl}
                  alt={`${track.title} artwork`}
                  width={384}
                  height={384}
                  className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="aspect-square w-full bg-white/10" />
              )}
              <button
                aria-label={
                  track.matchedYoutubeVideoId
                    ? `Play saved match for ${track.title}`
                    : `Match and play ${track.title}`
                }
                onClick={() => onSelect(track)}
                className="absolute inset-0 m-auto grid h-12 w-12 scale-90 place-items-center rounded-full bg-gradient-to-br from-[#fa233b] to-[#fb5c74] opacity-0 shadow-xl shadow-black/40 transition duration-300 group-hover:scale-100 group-hover:opacity-100"
              >
                {track.matchedYoutubeVideoId ? <Play size={20} fill="white" /> : <Search size={20} />}
              </button>
            </div>
            <p className="mt-3 text-[11px] font-bold uppercase text-[#fb5c74]">
              {track.matchedYoutubeVideoId ? "Ready to play" : "Match once"}
            </p>
            <h3 className="mt-3 truncate text-sm font-bold">{track.title}</h3>
            <p className="mt-1 truncate text-sm text-[#a1a1a6]">{track.artist}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="w-44 shrink-0 animate-pulse md:w-52">
      <div className="aspect-square rounded-2xl bg-white/10" />
      <div className="mt-3 h-4 w-4/5 rounded-full bg-white/10" />
      <div className="mt-2 h-3 w-3/5 rounded-full bg-white/10" />
    </div>
  );
}

function MobileTabBar({
  activeNav,
  onChange,
}: {
  activeNav: string;
  onChange: (label: string) => void;
}) {
  return (
    <nav data-testid="mobile-tab-bar" className="fixed bottom-0 left-0 right-0 z-50 grid h-16 grid-cols-4 border-t border-white/10 bg-black/85 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl md:hidden">
      {navigation.map((item) => {
        const Icon = item.icon;
        const isActive = activeNav === item.label;

        return (
          <button
            key={item.label}
            onClick={() => onChange(item.label)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-bold transition ${
              isActive ? "text-[#fb5c74]" : "text-[#a1a1a6]"
            }`}
          >
            <Icon size={21} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function YouTubeHiddenPlayer({
  track,
  isPlaying,
  volume,
  onEnded,
  onPlaybackError,
  onBufferingChange,
  onPlaybackChange,
  onProgressChange,
}: {
  track: YouTubeTrack | null;
  isPlaying: boolean;
  volume: number;
  onEnded: () => void;
  onPlaybackError: (reason: string) => void;
  onBufferingChange: (isBuffering: boolean) => void;
  onPlaybackChange: (isPlaying: boolean) => void;
  onProgressChange: (currentTime: number, duration: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const activeVideoIdRef = useRef<string | null>(null);
  const latestTrackRef = useRef(track);
  const isPlayingRef = useRef(isPlaying);
  const onEndedRef = useRef(onEnded);
  const onPlaybackErrorRef = useRef(onPlaybackError);
  const onBufferingChangeRef = useRef(onBufferingChange);
  const onPlaybackChangeRef = useRef(onPlaybackChange);
  const onProgressChangeRef = useRef(onProgressChange);
  const volumeRef = useRef(volume);

  useEffect(() => {
    latestTrackRef.current = track;
    isPlayingRef.current = isPlaying;
    onEndedRef.current = onEnded;
    onPlaybackErrorRef.current = onPlaybackError;
    onBufferingChangeRef.current = onBufferingChange;
    onPlaybackChangeRef.current = onPlaybackChange;
    onProgressChangeRef.current = onProgressChange;
    volumeRef.current = volume;
  }, [
    isPlaying,
    onBufferingChange,
    onEnded,
    onPlaybackChange,
    onPlaybackError,
    onProgressChange,
    track,
    volume,
  ]);

  useEffect(() => {
    let isMounted = true;

    const createPlayer = () => {
      if (!isMounted || !containerRef.current || playerRef.current || !window.YT) {
        return;
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        width: 1,
        height: 1,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current?.setVolume(volumeRef.current);
            window.__mixtapeSeekTo = (seconds: number) => {
              playerRef.current?.seekTo(seconds, true);
            };

            const latestTrack = latestTrackRef.current;

            if (latestTrack) {
              activeVideoIdRef.current = latestTrack.videoId;

              if (isPlayingRef.current) {
                playerRef.current?.loadVideoById(latestTrack.videoId);
              } else {
                playerRef.current?.cueVideoById(latestTrack.videoId);
              }
            }
          },
          onStateChange: (event) => {
            const state = window.YT?.PlayerState;

            if (!state) {
              return;
            }

            if (event.data === state.ENDED) {
              onEndedRef.current();
            }

            if (event.data === state.BUFFERING) {
              onBufferingChangeRef.current(true);
            }

            if (event.data === state.PLAYING) {
              onBufferingChangeRef.current(false);
              onPlaybackChangeRef.current(true);
            }

            if (event.data === state.PAUSED) {
              onBufferingChangeRef.current(false);
              onPlaybackChangeRef.current(false);
            }
          },
          onError: (event) => {
            onBufferingChangeRef.current(false);
            onPlaybackChangeRef.current(false);
            onPlaybackErrorRef.current(explainYouTubePlaybackError(event.data));
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      window.__mixtapeYouTubeReadyCallbacks ??= [];
      window.__mixtapeYouTubeReadyCallbacks.push(createPlayer);

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }

      window.onYouTubeIframeAPIReady = () => {
        window.__mixtapeYouTubeReadyCallbacks?.forEach((callback) => callback());
        window.__mixtapeYouTubeReadyCallbacks = [];
      };
    }

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;

    if (!readyRef.current || !player || !track) {
      return;
    }

    if (activeVideoIdRef.current !== track.videoId) {
      activeVideoIdRef.current = track.videoId;
      onProgressChangeRef.current(0, 0);

      if (isPlaying) {
        player.loadVideoById(track.videoId);
      } else {
        player.cueVideoById(track.videoId);
      }
    }
  }, [isPlaying, track]);

  useEffect(() => {
    const player = playerRef.current;

    if (!readyRef.current || !player || !track) {
      return;
    }

    if (isPlaying) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }
  }, [isPlaying, track]);

  useEffect(() => {
    if (!track || !isPlaying) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const player = playerRef.current;
      const currentTime = player?.getCurrentTime() ?? 0;
      const duration = player?.getDuration() ?? 0;

      if (currentTime < 1 && duration <= 0) {
        onBufferingChangeRef.current(false);
        onPlaybackChangeRef.current(false);
        onPlaybackErrorRef.current(
          "This YouTube video did not start. It may be restricted, unavailable for embedding, or waiting on YouTube playback. Skipping it.",
        );
      }
    }, 7000);

    return () => window.clearTimeout(timeout);
  }, [isPlaying, track]);

  useEffect(() => {
    if (readyRef.current) {
      playerRef.current?.setVolume(volume);
    }
  }, [volume]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = playerRef.current;

      if (!readyRef.current || !player) {
        return;
      }

      onProgressChangeRef.current(player.getCurrentTime() || 0, player.getDuration() || 0);
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      delete window.__mixtapeSeekTo;
      playerRef.current?.destroy();
    };
  }, []);

  return (
    <div className="pointer-events-none fixed -bottom-8 -right-8 h-px w-px opacity-0">
      <div ref={containerRef} />
    </div>
  );
}

function PlayerBar({
  currentTrack,
  isPlaying,
  isBuffering,
  liked,
  volume,
  currentTime,
  duration,
  onTogglePlay,
  onPrevious,
  onNext,
  onToggleLike,
  onVolumeChange,
  onSeek,
  onOpenNowPlaying,
}: {
  currentTrack: YouTubeTrack | null;
  isPlaying: boolean;
  isBuffering: boolean;
  liked: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onVolumeChange: (value: number) => void;
  onSeek: (seconds: number) => void;
  onOpenNowPlaying: () => void;
}) {
  const canPlay = Boolean(currentTrack);

  return (
    <footer data-testid="player-bar" className="fixed bottom-16 left-0 right-0 z-40 border-t border-white/10 bg-black/75 px-3 py-3 backdrop-blur-2xl md:bottom-0 md:px-4 lg:left-60">
      <div className="mx-auto grid max-w-7xl items-center gap-3 md:grid-cols-[1fr_1.2fr_1fr] md:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            disabled={!canPlay}
            onClick={onOpenNowPlaying}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left transition hover:bg-white/5 disabled:cursor-default"
          >
            {currentTrack ? (
              <Image
                src={currentTrack.thumbnail}
                alt={`${currentTrack.title} cover`}
                width={112}
                height={112}
                className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-lg"
              />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-xl bg-white/10" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{currentTrack?.title ?? "No track selected"}</span>
              <span className="block truncate text-xs text-[#a1a1a6]">{currentTrack?.artist ?? "Search to start"}</span>
            </span>
          </button>
          <button
            disabled={!canPlay}
            onClick={onToggleLike}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <Heart size={18} className={liked ? "text-[#fb5c74]" : ""} fill={liked ? "#fb5c74" : "none"} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 md:gap-3">
            <button className="grid h-11 w-11 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white">
              <Shuffle size={17} />
            </button>
            <button disabled={!canPlay} onClick={onPrevious} className="grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-40">
              <SkipBack size={20} fill="white" />
            </button>
            <button
              disabled={!canPlay}
              onClick={onTogglePlay}
              className="grid h-12 w-12 place-items-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-40"
            >
              {isBuffering ? (
                <Loader2 size={20} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={20} fill="black" />
              ) : (
                <Play size={20} fill="black" />
              )}
            </button>
            <button disabled={!canPlay} onClick={onNext} className="grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-40">
              <SkipForward size={20} fill="white" />
            </button>
            <button className="grid h-11 w-11 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white">
              <Repeat size={17} />
            </button>
          </div>
          <div className="grid w-full grid-cols-[42px_1fr_42px] items-center gap-3 text-[11px] text-[#a1a1a6]">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Seek"
              type="range"
              min="0"
              max={Math.max(duration, 1)}
              value={Math.min(currentTime, Math.max(duration, 1))}
              onChange={(event) => onSeek(Number(event.target.value))}
              onMouseUp={(event) => seekActivePlayer(Number(event.currentTarget.value))}
              onTouchEnd={(event) => seekActivePlayer(Number(event.currentTarget.value))}
              disabled={!canPlay}
              className="accent-[#fb5c74]"
            />
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="hidden items-center justify-end gap-3 md:flex">
          <button className="grid h-9 w-9 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white">
            <Mic2 size={18} />
          </button>
          <button className="grid h-9 w-9 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white">
            <ListMusic size={18} />
          </button>
          <Volume2 size={18} className="text-[#a1a1a6]" />
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            className="accent-[#fb5c74]"
          />
          <button
            disabled={!canPlay}
            onClick={onOpenNowPlaying}
            className="grid h-9 w-9 place-items-center rounded-full text-[#a1a1a6] transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </div>
    </footer>
  );
}

function NowPlayingOverlay({
  currentTrack,
  isPlaying,
  isBuffering,
  liked,
  currentTime,
  duration,
  onClose,
  onTogglePlay,
  onToggleLike,
  onNext,
  onPrevious,
}: {
  currentTrack: YouTubeTrack;
  isPlaying: boolean;
  isBuffering: boolean;
  liked: boolean;
  currentTime: number;
  duration: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onToggleLike: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const [lyrics, setLyrics] = useState<LyricsState | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLyricsLoading(true);
      setLyrics(null);

      void fetch(
        `/api/lyrics?artist=${encodeURIComponent(currentTrack.artist)}&title=${encodeURIComponent(currentTrack.title)}`,
        {
          signal: controller.signal,
        },
      )
        .then((response) => response.json() as Promise<LyricsState>)
        .then((payload) => setLyrics(payload))
        .catch(() => {
          if (!controller.signal.aborted) {
            setLyrics({
              provider: "none",
              title: currentTrack.title,
              artist: currentTrack.artist,
              lyrics: null,
              url: null,
              message: "Lyrics are unavailable right now.",
            });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLyricsLoading(false);
          }
        });
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [currentTrack]);

  return (
    <div data-testid="now-playing-overlay" className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4 text-white backdrop-blur-2xl md:p-5">
      <Image
        src={currentTrack.thumbnail}
        alt=""
        fill
        sizes="100vw"
        className="absolute inset-0 scale-110 object-cover opacity-25 blur-3xl"
      />
      <div className="relative mx-auto flex min-h-[calc(100vh-40px)] max-w-6xl flex-col">
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            className="min-h-11 rounded-full bg-white/10 px-5 py-2 text-sm font-bold backdrop-blur-xl transition hover:bg-white/20"
          >
            Done
          </button>
          <button className="grid h-11 w-11 place-items-center rounded-full bg-white/10 backdrop-blur-xl transition hover:bg-white/20">
            <MoreHorizontal size={20} />
          </button>
        </div>

        <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(280px,520px)_1fr] lg:gap-10 lg:py-10">
          <Image
            src={currentTrack.thumbnail}
            alt={`${currentTrack.title} cover`}
            width={720}
            height={720}
            className="mx-auto aspect-square w-full max-w-sm rounded-[24px] object-cover shadow-2xl shadow-black/60 md:max-w-xl md:rounded-[32px]"
          />
          <div>
            <p className="mb-3 text-sm font-bold uppercase text-[#fb5c74]">Now Playing</p>
            <h2 className="break-words text-4xl font-bold leading-none md:text-7xl">{currentTrack.title}</h2>
            <p className="mt-4 break-words text-xl text-[#d4d4d8] md:text-2xl">{currentTrack.artist}</p>
            <div className="mt-8 grid grid-cols-[44px_1fr_44px] items-center gap-3 text-sm text-[#d4d4d8] md:mt-10 md:gap-4">
              <span>{formatTime(currentTime)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#fa233b] to-[#fb5c74]"
                  style={{
                    width: `${duration ? Math.min((currentTime / duration) * 100, 100) : 0}%`,
                  }}
                />
              </div>
              <span>{formatTime(duration)}</span>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 md:gap-4">
              <button
                onClick={onToggleLike}
                className="grid h-12 w-12 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
              >
                <Heart size={20} className={liked ? "text-[#fb5c74]" : ""} fill={liked ? "#fb5c74" : "none"} />
              </button>
              <button onClick={onPrevious} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 transition hover:bg-white/20">
                <SkipBack size={22} fill="white" />
              </button>
              <button
                onClick={onTogglePlay}
                className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-xl transition hover:scale-105"
              >
                {isBuffering ? (
                  <Loader2 size={26} className="animate-spin" />
                ) : isPlaying ? (
                  <Pause size={26} fill="black" />
                ) : (
                  <Play size={26} fill="black" />
                )}
              </button>
              <button onClick={onNext} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 transition hover:bg-white/20">
                <SkipForward size={22} fill="white" />
              </button>
            </div>

            <div className="mt-10 rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-2xl md:p-6">
              <div className="mb-5 flex items-center gap-2 text-sm font-bold">
                <Mic2 size={18} />
                Lyrics
              </div>
              {lyricsLoading ? (
                <div className="space-y-3">
                  <div className="h-5 w-3/4 animate-pulse rounded-full bg-white/15" />
                  <div className="h-5 w-2/3 animate-pulse rounded-full bg-white/15" />
                  <div className="h-5 w-1/2 animate-pulse rounded-full bg-white/15" />
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xl font-bold leading-relaxed text-white/90">
                    {lyrics?.title ?? currentTrack.title}
                    <br />
                    <span className="text-base font-medium text-[#a1a1a6]">
                      {lyrics?.artist ?? currentTrack.artist}
                    </span>
                  </p>
                  <p className="text-sm leading-6 text-[#d4d4d8]">
                    {lyrics?.message ?? "Lyrics lookup is ready."}
                  </p>
                  {lyrics?.url ? (
                    <a
                      href={lyrics.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-zinc-200"
                    >
                      Open Lyrics
                    </a>
                  ) : null}
                  <p className="pt-2 text-xs text-[#a1a1a6]">
                    Source video: {currentTrack.rawTitle}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainder}`;
}

function explainYouTubePlaybackError(code: number) {
  if (code === 2) {
    return "YouTube rejected this video ID. Skipping to the next track.";
  }

  if (code === 5) {
    return "This video cannot play in the HTML5 YouTube player. Skipping it.";
  }

  if (code === 100) {
    return "This video is unavailable, private, or removed. Skipping it.";
  }

  if (code === 101 || code === 150) {
    return "The video owner does not allow embedded playback. Skipping it.";
  }

  return "YouTube could not play this track. Skipping it.";
}

function seekActivePlayer(seconds: number) {
  window.__mixtapeSeekTo?.(seconds);
}
