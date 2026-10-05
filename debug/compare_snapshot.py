#!/usr/bin/env python3
# Compares a snapshot against its committed baseline (git HEAD), ignoring
# functionSource and the order of computePlayerStats entries (sorted by team+number).
import json, subprocess, sys
name = sys.argv[1]
def norm(d):
    d['meta']['functionSource'] = ''
    d['computePlayerStats'] = sorted(d['computePlayerStats'], key=lambda e: (e['team'], e['number']))
    return json.dumps(d, indent=2, sort_keys=True).splitlines()
base = norm(json.loads(subprocess.check_output(['git', 'show', f'HEAD:debug/snapshots/{name}.json'])))
new = norm(json.load(open(f'debug/snapshots/{name}.json')))
if base == new:
    print(f'{name}: IDENTICAL')
else:
    import difflib
    print(f'{name}: DIFFERENT')
    print('\n'.join(list(difflib.unified_diff(base, new, lineterm=''))[:80]))
