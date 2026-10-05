# Numeric regression check of a snapshot against its git HEAD baseline.
#
# Labels/keys/display strings are ignored (C4: names are now resolved from the
# roster). Every remaining numeric difference must appear in ALLOWED below, as
# the exact rows removed and added in that section. Anything else fails (exit 1).
#
# The reference is debug/snapshots/baseline_legacy/ (the pre-C4 baseline), because
# the ALLOWED entries describe the changes from that baseline. Once the allowlist
# is consolidated, the reference moves to the committed baseline (HEAD).
#
# Usage: python3 debug/numeric_diff.py <snapshot-name>
import json, sys
from collections import Counter

name = sys.argv[1]
BASELINE_DIR = 'debug/snapshots/baseline_legacy'

# Expected numeric changes. Only by surname contradiction (see README).
# Final MTY vs AT: AT #35 "L. Ascolani" (another season) was credited to the
# 2026 #35 Mandujano; now it is an orphan. Mandujano's solo 2 -> 1.
ALLOWED = {
    'full-plays': {
        'computePlayerStats': {
            'removed': [
                '{"number": 35, "stats": {"defense": {"ast": 0, "ff": 0, "int": 1, "sacks": 0, "solo": 2, "tfl": 0}}, "team": "AT"}',
            ],
            'added': [
                '{"number": 35, "stats": {"defense": {"ast": 0, "ff": 0, "int": 1, "sacks": 0, "solo": 1, "tfl": 0}}, "team": "AT"}',
                '{"number": 35, "stats": {"defense": {"ast": 0, "ff": 0, "int": 0, "sacks": 0, "solo": 1, "tfl": 0}}, "team": "AT"}',
            ],
        },
    },
}
# Display-only fields: may change text (names), never numbers.
DISPLAY = {'label', 'key', 'receiver', 'functionSource'}

def strip(o):
    if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k not in DISPLAY}
    if isinstance(o, list): return [strip(v) for v in o]
    return o

def canon(o): return json.dumps(strip(o), sort_keys=True)

def leaves(section, path=''):
    out = Counter()
    if isinstance(section, dict):
        for k, v in section.items(): out.update(leaves(v, path))
    elif isinstance(section, list):
        for v in section: out.update(leaves(v, path))
    elif section is not None:
        out[f'{path}|{json.dumps(section)}'] += 1
    return out

def rows_of(sec, data):
    if sec == 'computePlayerStats':
        return Counter(canon(e) for e in data[sec])
    # maps/records: canonical record per object that carries numbers
    out = Counter()
    def walk(o):
        if isinstance(o, dict) and o and all(not isinstance(v, (dict, list)) for v in o.values()):
            out[canon(o)] += 1
        elif isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(strip(data[sec]))
    return out

base = json.load(open(f'{BASELINE_DIR}/{name}.json'))
new = json.load(open(f'debug/snapshots/{name}.json'))
allowed = ALLOWED.get(name, {})
failures = []
for sec in base:
    if sec == 'meta': continue
    bl, nl = rows_of(sec, base), rows_of(sec, new)
    removed, added = bl - nl, nl - bl
    exp = allowed.get(sec, {'removed': [], 'added': []})
    exp_rem, exp_add = Counter(exp['removed']), Counter(exp['added'])
    if removed != exp_rem or added != exp_add:
        failures.append(sec)
        print(f'[{sec}] UNEXPECTED numeric change')
        for k in removed - exp_rem: print('   - removed', k[:220])
        for k in added - exp_add: print('   + added  ', k[:220])
        for k in exp_rem - removed: print('   ! expected removal missing', k[:220])
        for k in exp_add - added: print('   ! expected addition missing', k[:220])
    elif exp_rem or exp_add:
        print(f'[{sec}] allowed change matched: -{sum(exp_rem.values())} / +{sum(exp_add.values())} rows (surname contradiction)')
print(f'{name}: {"NUMERICALLY OK" if not failures else "FAIL (" + str(len(failures)) + " section(s) unexpected)"}')
sys.exit(1 if failures else 0)
