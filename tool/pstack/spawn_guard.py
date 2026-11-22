#!/usr/bin/env python3
"""PreToolUse hook that checks `model` and `effort` before a subagent spawns.

Origin: written by the repository owner for another project and adapted for DocBridge.
It is covered by this repository's LICENSE.

The hook reads the hook JSON from stdin. It exits 2, which blocks the spawn, when the
model or the effort is missing, unknown, or outside the range in `.agents/rules/pstack-models.md`.
Every other outcome exits 0. An internal failure prints a warning and exits 0 (fail open),
so a bug here never blocks all spawns.

The table is `{provider: {model: [(low, high), ...]}}`. A model that appears at several
levels gets the union of its ranges, and an effort passes when one range holds it.
"""
import json
import re
import sys
from pathlib import Path

ORDER = ['low', 'medium', 'high', 'xhigh', 'max']
TARGETS = ('Agent', 'mcp__t3-code__delegate_task')
EFFORT_OPTIONS = ('effort', 'reasoningEffort', 'thought_level')
ENTRY = re.compile(r'([a-z]+)=([a-z0-9.-]+)\s*\(\s*([a-z]+)\s*-\s*([a-z]+)\s*,\s*\*([a-z]+)\s*\)')
RULE = '.agents/rules/pstack-models.md'


def parse_table(text):
    """Parse the `<provider>: <level>=<model> (<low>-<high>, *<default>), ...` lines."""
    table = {}
    for line in text.splitlines():
        m = re.match(r'\s*([a-z][a-z0-9-]*):(.*)', line)
        if not m:
            continue
        entries = {}
        for e in ENTRY.findall(m.group(2)):
            entries.setdefault(e[1], []).append((e[2], e[3]))
        if entries:
            table[m.group(1)] = entries
    return table


def normalize_effort(value):
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    return value if value in ORDER else None


def extract_effort_option(options):
    """Accept an object, or a list of `{id, value}` items."""
    if isinstance(options, dict):
        return next((options[key] for key in EFFORT_OPTIONS if key in options), None)
    if isinstance(options, list):
        for item in options:
            if isinstance(item, dict) and item.get('id') in EFFORT_OPTIONS:
                return item.get('value')
    return None


def find_model(table, model):
    """The table entry whose name is the longest substring of `model`, or None."""
    lowered = model.lower()
    found = None
    for entries in table.values():
        for name, ranges in entries.items():
            if name in lowered and (found is None or len(name) > len(found[0])):
                found = (name, ranges)
    return found


def known_models(table):
    return sorted({name for entries in table.values() for name in entries})


def extract(tool_name, tool_input):
    """Return `(model, effort)`, or None for a tool the guard ignores."""
    if tool_name == 'Agent':
        return tool_input.get('model'), tool_input.get('effort')
    if tool_name == 'mcp__t3-code__delegate_task':
        target = tool_input.get('target') or {}
        return target.get('model'), extract_effort_option(target.get('options'))
    return None


def check(tool_name, tool_input, table):
    """Return the reason to block the spawn, or None to allow it."""
    got = extract(tool_name, tool_input if isinstance(tool_input, dict) else {})
    if got is None:
        return None
    model, raw_effort = got
    fix = f'Spawn again with an explicit effort (rules: {RULE}).'
    if not isinstance(model, str) or not model.strip():
        return (f'The model is missing. Name one instead of inheriting the parent model. '
                f'Known models: {", ".join(known_models(table))}. {fix}')
    found = find_model(table, model)
    if found is None:
        return (f'The model "{model}" is not in the table. Known models: {", ".join(known_models(table))}. '
                f'Spawn again with a listed model (rules: {RULE}).')
    name, ranges = found
    spans = ', '.join(f'{low} to {high}' for low, high in ranges)
    scope = f'The effort range for {name} is {spans}.'
    if raw_effort is None or (isinstance(raw_effort, str) and not raw_effort.strip()):
        return f'The effort is missing. {scope} {fix}'
    effort = normalize_effort(raw_effort)
    if effort is None:
        return f'The effort "{raw_effort}" is not recognized. {scope} {fix}'
    if not any(ORDER.index(low) <= ORDER.index(effort) <= ORDER.index(high) for low, high in ranges):
        return f'The effort "{effort}" is outside the range of {name}. {scope} {fix}'
    return None


def read_table():
    root = Path(__file__).resolve().parents[2]
    return parse_table((root / RULE).read_text(encoding='utf-8'))


def main():
    try:
        payload = json.load(sys.stdin)
        tool_name = payload.get('tool_name')
        if tool_name not in TARGETS:
            return 0
        reason = check(tool_name, payload.get('tool_input') or {}, read_table())
    except Exception as exc:  # fail open: an internal failure must not block every spawn
        print(f'spawn_guard: warning: the check failed, so the spawn is allowed ({exc!r})', file=sys.stderr)
        return 0
    if reason:
        print(f'Spawn blocked. {reason}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
