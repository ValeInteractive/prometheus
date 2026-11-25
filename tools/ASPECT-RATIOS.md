# Prometheus picture aspect-ratio scanner

Estimates the actual movie picture ratio, excluding embedded black bars. It does not crop, re-encode, rename, or write to movie files. It does not change player sizing, Jellyfin metadata, or Prometheus screens.

## Requirements

Run on the media VM with Python 3 and Docker access. The Jellyfin container provides `/usr/lib/jellyfin-ffmpeg/ffmpeg` and `ffprobe`. No API keys or passwords are needed. The movie directory must be readable inside that container.

## Run

```bash
python3 scan-aspect-ratios.py --container jellyfin --choose-root --output /srv/prometheus/data/movie-aspect-ratios.json
```

Choose the directory containing movies using the RIGHT-HAND container path shown in the mount list. If the mount is `/media` and movies are below it, enter `/media/Movies`, not the host path. Choose the movies directory, not a combined movies/series directory. The tool follows ordinary files beneath that directory and skips common trailer/extras folders and filenames. It scans every video version separately.

For a trial, add `--limit 3`. For one file use `--file '/media/Movies/Example/Example.mkv'` instead of `--choose-root`.

Stop with Ctrl+C if needed. Completed results are saved after each file. Rerun to skip unchanged completed scans; use `--rescan` to repeat analysis. Files are considered unchanged by path, size and modification time, rather than a full content hash.

## Results

The JSON report stores file dimensions, pixel shape, sampled timestamps, estimated picture boundaries and ratio. Status is `estimated`, `possible_variable`, `needs_review`, or `error`. The file display ratio is kept separately from the detected picture ratio. Keep reports private: they contain media paths and filenames.

Seven six-second samples cover 8% through 92% of the duration. FFmpeg decodes one file at a time using one decoder thread; scans still use CPU and disk bandwidth. Cache reuse avoids repeating unchanged files. No background service or scheduled scan is installed.

A possible variable ratio is a review flag, not a verified IMAX classification. Dark scenes, subtitles in bars, opening/closing titles, HDR, and unusual framing can affect detection. Sparse sampling can miss brief aspect-ratio changes. This is not a full-film measurement and must not be used to automatically crop playback.

## Validation

Tested locally with generated full-frame 16:9, letterboxed 2.39:1, pillarboxed 4:3, and non-square-pixel video. Classification checks cover repeated different ratios and insufficient samples. Server/container execution and real-library results still require validation.

FFmpeg cropdetect reference: https://ffmpeg.org/ffmpeg-filters.html#cropdetect
