const priority = [
  "animation", "documentary", "reality", "family", "horror", "science fiction",
  "fantasy", "western", "war", "crime", "mystery", "thriller", "action",
  "adventure", "romance", "comedy", "drama",
];

export const primaryGenreChanged = "prometheus:primary-genre-changed";
const key = (id: string) => `prometheus:primary-genre:${id.toLowerCase()}`;

export function genreOptions(tags: string[]) {
  return [...new Map(tags.map((tag) => [tag.trim().toLowerCase(), tag.trim()])).values()]
    .filter(Boolean);
}

export function primaryGenre(id: string, tags: string[]) {
  const options = genreOptions(tags);
  const override = readGenreOverride(id);
  return options.find((tag) => tag.toLowerCase() === override?.toLowerCase()) ??
    priority.map((name) => options.find((tag) => tag.toLowerCase() === name)).find(Boolean) ??
    options.sort((a, b) => a.localeCompare(b))[0];
}

export function readGenreOverride(id: string) {
  try {
    return localStorage.getItem(key(id));
  } catch {
    return null;
  }
}

export function saveGenreOverride(id: string, genre: string | null) {
  if (genre === null) localStorage.removeItem(key(id));
  else localStorage.setItem(key(id), genre);
  window.dispatchEvent(new Event(primaryGenreChanged));
}
