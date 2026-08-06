import { NextResponse } from "next/server";

type GeniusHit = {
  result?: {
    url?: string;
    title?: string;
    primary_artist?: {
      name?: string;
    };
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();
  const title = searchParams.get("title")?.trim();
  const geniusToken = process.env.GENIUS_ACCESS_TOKEN;

  if (!artist || !title) {
    return NextResponse.json(
      { error: "Artist and title are required." },
      { status: 400 },
    );
  }

  if (!geniusToken) {
    return NextResponse.json({
      provider: "none",
      title,
      artist,
      lyrics: null,
      url: null,
      message: "Add GENIUS_ACCESS_TOKEN or MUSIXMATCH_API_KEY to enable lyrics lookup.",
    });
  }

  const url = new URL("https://api.genius.com/search");
  url.searchParams.set("q", `${artist} ${title}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${geniusToken}`,
      Accept: "application/json",
    },
    next: {
      revalidate: 60 * 60 * 24,
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Lyrics lookup failed.",
        details: await response.text(),
      },
      { status: response.status },
    );
  }

  const payload = (await response.json()) as {
    response?: {
      hits?: GeniusHit[];
    };
  };
  const hit = payload.response?.hits?.[0]?.result;

  return NextResponse.json({
    provider: "genius",
    title: hit?.title ?? title,
    artist: hit?.primary_artist?.name ?? artist,
    lyrics: null,
    url: hit?.url ?? null,
    message: hit?.url
      ? "Open the matched Genius page for full lyrics."
      : "No lyrics match found.",
  });
}
