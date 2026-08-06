/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const sourceUrl =
  process.argv[2] ??
  "https://songsha.re/open/6ed73622e6424b3688d2ebcb33b1a18617841281189380531";
const htmlPath = process.argv[3] ?? path.join(process.cwd(), "songshift-favourite-songs.html");

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseSongShiftHtml(html) {
  const nameMatch = html.match(/<h5[^>]*>([\s\S]*?)<\/h5>\s*<p[^>]*>\s*\d+\s+songs/i);
  const name = nameMatch ? decodeHtml(nameMatch[1]) : "Imported SongShift Playlist";
  const rowPattern =
    /<div style="display: flex; flex-grow: 1; align-items: center; margin-top: 3px; margin-bottom: 3px;">\s*<img[^>]+src="([^"]+)"[^>]*>\s*<div>\s*<h6[^>]*>([\s\S]*?)<\/h6>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  const tracks = [];
  let row;

  while ((row = rowPattern.exec(html))) {
    const title = decodeHtml(row[2]);
    const artist = decodeHtml(row[3]);

    tracks.push({
      title,
      artist,
      artworkUrl: row[1],
      normalizedKey: `${normalize(title)}::${normalize(artist)}`,
    });
  }

  return {
    name,
    tracks,
  };
}

async function main() {
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`SongShift HTML file not found: ${htmlPath}`);
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  const imported = parseSongShiftHtml(html);

  if (!imported.tracks.length) {
    throw new Error("No SongShift tracks were found in the HTML file.");
  }

  const playlist = await prisma.importedPlaylist.upsert({
    where: {
      sourceUrl,
    },
    create: {
      name: imported.name,
      source: "songshift",
      sourceUrl,
      externalId: sourceUrl.split("/").pop(),
    },
    update: {
      name: imported.name,
      source: "songshift",
      externalId: sourceUrl.split("/").pop(),
    },
  });

  await prisma.$transaction(
    imported.tracks.map((track, index) =>
      prisma.importedTrack.upsert({
        where: {
          importedPlaylistId_position: {
            importedPlaylistId: playlist.id,
            position: index,
          },
        },
        create: {
          importedPlaylistId: playlist.id,
          title: track.title,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
          position: index,
          normalizedKey: track.normalizedKey,
        },
        update: {
          title: track.title,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
          position: index,
        },
      }),
    ),
  );

  console.log(
    JSON.stringify(
      {
        playlist: imported.name,
        importedTracks: imported.tracks.length,
        sourceUrl,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
