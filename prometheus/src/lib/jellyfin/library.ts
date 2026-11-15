import "server-only";

const REQUEST_TIMEOUT_MS = 15000;
const ITEMS_PER_CATEGORY = 30;
const RECENT_ITEMS_PER_CATEGORY = 10;

export type PrometheusMediaType = "Movie" | "Series";

export interface PrometheusMediaItem {
  id: string;
  type: PrometheusMediaType;
  title: string;
  overview: string | null;
  productionYear: number | null;
  genres: string[];
  communityRating: number | null;
  runtimeTicks: number | null;
  dateCreated: string | null;
  played?: boolean;
  favourite?: boolean;
  lastPlayedAt?: string | null;
  hasPoster: boolean;
  hasBackdrop: boolean;
}

export interface PrometheusLibrary {
  movies: PrometheusMediaItem[];
  series: PrometheusMediaItem[];
  recentlyAddedMovies: PrometheusMediaItem[];
  recentlyAddedSeries: PrometheusMediaItem[];
}

export class JellyfinLibraryError extends Error {
  constructor() {
    super("Jellyfin library unavailable.");
    this.name = "JellyfinLibraryError";
  }
}

function getServerUrl(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new JellyfinLibraryError();
  }

  try {
    const parsed = new URL(configured);

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      throw new JellyfinLibraryError();
    }

    return parsed.origin;
  } catch {
    throw new JellyfinLibraryError();
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function optionalString(
  value: unknown,
  maximumLength: number,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    return null;
  }

  return value.slice(0, maximumLength);
}

function optionalNumber(
  value: unknown,
): number | null {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function parseItem(
  value: unknown,
  expectedType: PrometheusMediaType,
): PrometheusMediaItem | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.Type !== expectedType ||
    typeof value.Id !== "string" ||
    !/^[a-f0-9]{32}$/i.test(value.Id) ||
    typeof value.Name !== "string" ||
    !value.Name.trim()
  ) {
    return null;
  }

  const imageTags = isRecord(value.ImageTags)
    ? value.ImageTags
    : {};

  const backdropTags = Array.isArray(
    value.BackdropImageTags,
  )
    ? value.BackdropImageTags
    : [];

  const genres = Array.isArray(value.Genres)
    ? value.Genres.filter(
        (genre): genre is string =>
          typeof genre === "string" &&
          genre.length > 0,
      )
        .slice(0, 20)
        .map((genre) => genre.slice(0, 100))
    : [];

  return {
    id: value.Id,
    type: expectedType,
    title: value.Name.slice(0, 300),
    overview: optionalString(value.Overview, 3000),
    productionYear: optionalNumber(
      value.ProductionYear,
    ),
    genres,
    communityRating: optionalNumber(
      value.CommunityRating,
    ),
    runtimeTicks: optionalNumber(
      value.RunTimeTicks,
    ),
    dateCreated: optionalString(
      value.DateCreated,
      64,
    ),
    played: isRecord(value.UserData) && typeof value.UserData.Played === "boolean"
      ? value.UserData.Played : undefined,
    favourite: isRecord(value.UserData) && value.UserData.IsFavorite === true,
    lastPlayedAt: isRecord(value.UserData) ? optionalString(value.UserData.LastPlayedDate, 64) : null,
    hasPoster:
      typeof imageTags.Primary === "string" &&
      imageTags.Primary.length > 0,
    hasBackdrop: backdropTags.some(
      (tag) =>
        typeof tag === "string" &&
        tag.length > 0,
    ),
  };
}

async function fetchCategory(
  serverUrl: string,
  userId: string,
  accessToken: string,
  type: PrometheusMediaType,
  browse?: { search?: string; favourites?: boolean; offset: number; catalogue?: boolean; allFavourites?: boolean },
): Promise<PrometheusMediaItem[]> {
  const url = new URL(
    `/Users/${encodeURIComponent(userId)}/Items`,
    serverUrl,
  );

  url.searchParams.set("Recursive", "true");
  url.searchParams.set("IncludeItemTypes", type);
  if (!browse) url.searchParams.set("EnableUserData", "true");
  url.searchParams.set("SortBy", "DateCreated");
  url.searchParams.set("SortOrder", "Descending");
  if (browse) {
    url.searchParams.set("Limit", String(ITEMS_PER_CATEGORY));
  }
  url.searchParams.set(
    "Fields",
    "Overview,Genres,DateCreated",
  );
  url.searchParams.set(
    "EnableTotalRecordCount",
    "false",
  );

  if (browse) {
    url.searchParams.set("SortBy", "SortName");
    url.searchParams.set("SortOrder", "Ascending");
    url.searchParams.set("StartIndex", String(browse.offset));
    if (browse.catalogue || browse.allFavourites) {
      url.searchParams.set("EnableUserData", "true");
      url.searchParams.delete("Limit");
      url.searchParams.set("Fields", "Genres,DateCreated");
    }
    if (browse.search) url.searchParams.set("SearchTerm", browse.search);
    if (browse.favourites || browse.allFavourites) url.searchParams.set("Filters", "IsFavorite");
  }

  const response = await fetch(url, {
    redirect: "error",
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(
      REQUEST_TIMEOUT_MS,
    ),
    headers: {
      Accept: "application/json",
      Authorization:
        `MediaBrowser Token="${accessToken}"`,
    },
  });

  if (!response.ok) {
    throw new JellyfinLibraryError();
  }

  const payload: unknown = await response.json();

  if (
    !isRecord(payload) ||
    !Array.isArray(payload.Items)
  ) {
    throw new JellyfinLibraryError();
  }

  return payload.Items
    .map((item: unknown) =>
      parseItem(item, type),
    )
    .filter(
      (item): item is PrometheusMediaItem =>
        item !== null,
    );
}

export async function getPrometheusLibrary(
  userId: string,
  accessToken: string,
): Promise<PrometheusLibrary> {
  if (
    typeof userId !== "string" ||
    !/^[a-f0-9]{32}$/i.test(userId) ||
    typeof accessToken !== "string" ||
    !accessToken
  ) {
    throw new JellyfinLibraryError();
  }

  try {
    const serverUrl = getServerUrl();

    const [movies, series] = await Promise.all([
      fetchCategory(
        serverUrl,
        userId,
        accessToken,
        "Movie",
      ),
      fetchCategory(
        serverUrl,
        userId,
        accessToken,
        "Series",
      ),
    ]);

    const newestFirst = (
      items: PrometheusMediaItem[],
    ) =>
      [...items]
        .sort((first, second) =>
          (second.dateCreated ?? "").localeCompare(
            first.dateCreated ?? "",
          ),
        )
        .slice(0, RECENT_ITEMS_PER_CATEGORY);

    return {
      movies,
      series,
      recentlyAddedMovies: newestFirst(movies),
      recentlyAddedSeries: newestFirst(series),
    };
  } catch {
    throw new JellyfinLibraryError();
  }
}

export async function browsePrometheusLibrary(
  userId: string,
  accessToken: string,
  type: PrometheusMediaType,
  browse: { search?: string; favourites?: boolean; offset: number; catalogue?: boolean; allFavourites?: boolean },
) {
  if (!/^[a-f0-9]{32}$/i.test(userId) || !accessToken) throw new JellyfinLibraryError();
  return fetchCategory(getServerUrl(), userId, accessToken, type, browse);
}
