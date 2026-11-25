#!/usr/bin/env python3
"""Read-only picture-ratio estimates using sampled FFmpeg cropdetect results."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from fractions import Fraction
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

VERSION = 1
EXTENSIONS = {'.mkv', '.mp4', '.m4v', '.avi', '.mov', '.mpg', '.mpeg', '.ts', '.webm'}
EXTRAS = {'trailers', 'extras', 'samples', 'sample', 'behind the scenes', 'deleted scenes', 'featurettes'}
POSITIONS = (.08, .2, .35, .5, .65, .8, .92)

def run(args, container=None, timeout=120):
    command = ['docker', 'exec', container, *args] if container else args
    return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=timeout)

def label(ratio):
    known = [(4/3, '4:3'), (1.66, '1.66:1'), (16/9, '16:9'), (1.85, '1.85:1'),
             (1.9, '1.90:1'), (2.0, '2.00:1'), (2.2, '2.20:1'), (2.35, '2.35:1'),
             (2.39, '2.39:1'), (2.76, '2.76:1')]
    closest, name = min(known, key=lambda pair: abs(pair[0] - ratio))
    return name if abs(closest - ratio) / closest < .012 else f'{ratio:.2f}:1'

def classify(samples):
    groups = []
    for sample in samples:
        if 'ratio' not in sample:
            continue
        ratio = sample['ratio']
        group = next((g for g in groups if abs(ratio - g['ratio']) / g['ratio'] < .025), None)
        if group is None:
            groups.append({'ratio': ratio, 'values': [ratio]})
        else:
            group['values'].append(ratio)
            group['ratio'] = sum(group['values']) / len(group['values'])
    groups.sort(key=lambda g: len(g['values']), reverse=True)
    valid = sum(len(g['values']) for g in groups)
    if valid < 5:
        return {'status': 'needs_review', 'label': 'Insufficient reliable samples', 'valid_samples': valid}
    dominant = groups[0]
    recurring = [g for g in groups if len(g['values']) >= 2]
    if len(recurring) >= 2 and abs(recurring[0]['ratio'] - recurring[1]['ratio']) / recurring[0]['ratio'] > .05:
        return {'status': 'possible_variable', 'label': 'Possible variable aspect ratio',
                'ratios': [round(g['ratio'], 4) for g in recurring], 'valid_samples': valid}
    if len(dominant['values']) / len(POSITIONS) >= .7:
        return {'status': 'estimated', 'label': label(dominant['ratio']),
                'picture_ratio': round(dominant['ratio'], 4),
                'agreeing_samples': len(dominant['values']), 'valid_samples': valid}
    return {'status': 'needs_review', 'label': 'Inconsistent samples', 'valid_samples': valid}

def analyse(path, container, ffmpeg, ffprobe):
    probe = json.loads(run([ffprobe, '-v', 'error', '-select_streams', 'v:0',
        '-show_streams', '-show_format', '-of', 'json', path], container).stdout)
    stream = probe['streams'][0]
    width, height = int(stream['width']), int(stream['height'])
    duration = float(probe.get('format', {}).get('duration') or stream.get('duration') or 0)
    if duration < 20:
        return {'status': 'needs_review', 'label': 'Video too short for reliable sampling'}
    sar_text = stream.get('sample_aspect_ratio', '1:1')
    try:
        sar = float(Fraction(sar_text.replace(':', '/')))
        if sar <= 0:
            sar = 1.0
    except (ValueError, ZeroDivisionError):
        sar = 1.0
    rotations = [data.get('rotation', 0) for data in stream.get('side_data_list', [])]
    if any(float(rotation) % 360 != 0 for rotation in rotations):
        return {'status': 'needs_review', 'label': 'Rotated video requires manual review'}
    samples = []
    for fraction in POSITIONS:
        seconds = min(duration * fraction, duration - 7)
        try:
            result = run([ffmpeg, '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info',
                '-threads', '1', '-noautorotate', '-ss', str(seconds), '-i', path,
                '-map', '0:v:0', '-an', '-sn', '-dn', '-t', '6', '-filter_threads', '1',
                '-vf', 'fps=2,format=yuv420p,cropdetect=limit=0.094:round=2:reset=0:skip=2',
                '-f', 'null', '-'], container)
            crops = re.findall(rb'crop=(\d+):(\d+):(\d+):(\d+)', result.stderr)
            if len(crops) < 4:
                raise ValueError('No reliable picture boundary')
            w, h, x, y = map(int, crops[-1])
            if not (w > 0 and h > 0 and x >= 0 and y >= 0 and x+w <= width and y+h <= height):
                raise ValueError('Invalid crop')
            if w*h < width*height*.35 or abs(x - (width-w)/2) > width*.04 or abs(y - (height-h)/2) > height*.04:
                raise ValueError('Dark or asymmetric scene')
            ratio = w * sar / h
            if not .9 <= ratio <= 3.3:
                raise ValueError('Unusual boundary')
            samples.append({'seconds': round(seconds, 2), 'crop': [w, h, x, y], 'ratio': ratio})
        except (subprocess.SubprocessError, ValueError):
            samples.append({'seconds': round(seconds, 2), 'error': 'Sample requires review'})
    result = classify(samples)
    result.update({'width': width, 'height': height, 'sample_aspect_ratio': sar_text,
                   'file_display_ratio': round(width*sar/height, 4), 'duration_seconds': duration,
                   'samples': samples})
    if stream.get('color_transfer') in ('smpte2084', 'arib-std-b67'):
        result['warning'] = 'HDR: black-bar threshold may be less reliable; review this estimate.'
    return result

def save(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.aspect-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(report, output, indent=2, ensure_ascii=False)
            output.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--root', help='Movie directory, as seen inside Jellyfin when using --container')
    group.add_argument('--file', help='One movie file to test')
    group.add_argument('--choose-root', action='store_true', help='Show Jellyfin mounts and ask for the movie directory')
    parser.add_argument('--container', help='Use FFmpeg and media paths inside this Docker container')
    parser.add_argument('--output', required=True, type=Path, help='JSON report on this machine, outside movie folders')
    parser.add_argument('--limit', type=int, default=0, help='Maximum files this run; 0 means all')
    parser.add_argument('--rescan', action='store_true', help='Repeat scans even if size and modified time match')
    args = parser.parse_args()
    if args.choose_root:
        if not args.container:
            parser.error('--choose-root requires --container')
        mounts = run(['docker', 'inspect', args.container, '--format',
                      '{{range .Mounts}}{{println .Source \" -> \" .Destination}}{{end}}']).stdout
        print(mounts.decode())
        args.root = input('Movies directory INSIDE Jellyfin (right-hand path, including Movies subfolder if needed): ').strip()
        if not args.root or args.root == '/':
            parser.error('Specify the movie directory, not the container root')
    ffmpeg = '/usr/lib/jellyfin-ffmpeg/ffmpeg' if args.container else 'ffmpeg'
    ffprobe = '/usr/lib/jellyfin-ffmpeg/ffprobe' if args.container else 'ffprobe'
    for binary in (ffmpeg, ffprobe):
        run([binary, '-version'], args.container, timeout=15)
    if args.file:
        files = [args.file]
    elif args.container:
        if not args.root.startswith('/'):
            parser.error('--root must be an absolute container path')
        files = [os.fsdecode(p) for p in run(['find', args.root, '-type', 'f', '-print0'], args.container).stdout.split(b'\0') if p]
    else:
        files = [str(p.resolve()) for p in Path(args.root).rglob('*') if p.is_file() and not p.is_symlink()]
    files = sorted(p for p in files if Path(p).suffix.lower() in EXTENSIONS and
                   not any(part.lower() in EXTRAS for part in Path(p).parts) and
                   not re.search(r'(?:[- .](?:trailer|sample))$', Path(p).stem, re.I))
    if args.limit:
        files = files[:args.limit]
    if not files:
        parser.error('No movie files found; check the path')
    if args.output.exists():
        report = json.loads(args.output.read_text())
        if report.get('scanner_version') != VERSION or not isinstance(report.get('movies'), dict):
            parser.error('Existing report is from an unsupported scanner version; use a new output path')
    else:
        report = {'scanner_version': VERSION, 'method': 'Seven six-second samples; estimated, never applied to playback', 'movies': {}}
    for index, path in enumerate(files, 1):
        key = (args.container or 'local') + ':' + path
        try:
            if args.container:
                fingerprint = run(['stat', '-c', '%s:%Y', path], args.container, timeout=15).stdout.decode().strip()
            else:
                stat = Path(path).stat()
                fingerprint = f'{stat.st_size}:{stat.st_mtime_ns}'
            previous = report['movies'].get(key, {})
            if not args.rescan and previous.get('fingerprint') == fingerprint and previous.get('status') != 'error':
                print(f'[{index}/{len(files)}] Cached: {Path(path).name}', flush=True)
                continue
            print(f'[{index}/{len(files)}] Scanning: {Path(path).name}', flush=True)
            result = analyse(path, args.container, ffmpeg, ffprobe)
            result.update({'fingerprint': fingerprint, 'path': path, 'scanned_at': datetime.now(timezone.utc).isoformat()})
        except (subprocess.SubprocessError, ValueError, KeyError, IndexError, OSError):
            result = {'path': path, 'status': 'error', 'label': 'Scan failed; verify file and decoder support'}
        report['movies'][key] = result
        save(args.output, report)
        print('  ' + result['label'], flush=True)
    counts = Counter(value['status'] for value in report['movies'].values())
    print('Saved:', args.output)
    print('Summary:', dict(counts))

if __name__ == '__main__':
    main()
