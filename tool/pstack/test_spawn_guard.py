"""Offline tests for spawn_guard.py and the hook command in `.claude/settings.json`.

Origin: adapted from the repository owner's tests in another project. Covered by this repository's LICENSE.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import spawn_guard as g

ROOT = Path(__file__).resolve().parents[2]
TABLE = g.parse_table(
    'claude: high=opus (low-high, *medium), mid=sonnet (low-high, *medium), low=haiku (low-max, *xhigh)\n'
    'codex: high=sol (low-xhigh, *high), mid=terra (low-high, *medium), low=luna (low-max, *xhigh)\n'
    'devin: high=adaptive (medium-max, *max), low=swe-2-flash (medium-max, *medium)\n')


def agent(model=None, effort=None):
    tool_input = {'prompt': 'x'}
    if model is not None:
        tool_input['model'] = model
    if effort is not None:
        tool_input['effort'] = effort
    return g.check('Agent', tool_input, TABLE)


def delegate(model=None, options=None):
    target = {}
    if model is not None:
        target['model'] = model
    if options is not None:
        target['options'] = options
    return g.check('mcp__t3-code__delegate_task', {'target': target}, TABLE)


class ParseTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(TABLE['claude']['haiku'], [('low', 'max')])
        self.assertEqual(TABLE['codex']['terra'], [('low', 'high')])

    def test_real_rule_file(self):
        table = g.parse_table((ROOT / g.RULE).read_text(encoding='utf-8'))
        self.assertIn('opus', table['claude'])
        self.assertIn('luna', table['codex'])

    def test_same_model_at_two_levels_unions_the_ranges(self):
        table = g.parse_table('claude: high=opus (low-high, *medium), mid=opus (low-medium, *medium)\n')
        self.assertEqual(table['claude']['opus'], [('low', 'high'), ('low', 'medium')])
        self.assertIsNone(g.check('Agent', {'model': 'opus', 'effort': 'high'}, table))
        self.assertIsNotNone(g.check('Agent', {'model': 'opus', 'effort': 'max'}, table))


class AgentTest(unittest.TestCase):
    def test_missing_model_or_effort_blocks(self):
        self.assertIsNotNone(agent(None, 'medium'))
        self.assertIsNotNone(agent('sonnet'))
        self.assertIsNotNone(agent('sonnet', ''))
        self.assertIsNotNone(agent('sonnet', 'turbo'))

    def test_effort_outside_the_range_blocks(self):
        self.assertIsNotNone(agent('sonnet', 'xhigh'))
        self.assertIsNotNone(agent('opus', 'xhigh'))

    def test_effort_inside_the_range_passes(self):
        self.assertIsNone(agent('sonnet', 'medium'))
        self.assertIsNone(agent('haiku', 'xhigh'))
        self.assertIsNone(agent('haiku', 'max'))

    def test_unknown_model_blocks(self):
        self.assertIn('opus', agent('fable', 'medium'))

    def test_any_version_of_a_family_passes(self):
        self.assertIsNone(agent('claude-sonnet-9-0', 'High'))
        self.assertIsNone(agent('claude-opus-12-3', 'medium'))


class DelegateTest(unittest.TestCase):
    def test_effort_as_object_or_list(self):
        self.assertIsNone(delegate('terra', {'effort': 'medium'}))
        self.assertIsNone(delegate('luna', [{'id': 'effort', 'value': 'max'}]))
        self.assertIsNotNone(delegate('terra', [{'id': 'effort', 'value': 'xhigh'}]))
        self.assertIsNone(delegate('sol', {'effort': 'xhigh'}))

    def test_provider_specific_effort_option_names(self):
        self.assertIsNone(delegate('gpt-6.1-terra', [{'id': 'reasoningEffort', 'value': 'high'}]))
        self.assertIsNotNone(delegate('gpt-6.1-terra', [{'id': 'reasoningEffort', 'value': 'ultra'}]))
        self.assertIsNone(delegate('adaptive', [{'id': 'thought_level', 'value': 'max'}]))
        self.assertIsNotNone(delegate('adaptive', [{'id': 'thought_level', 'value': 'low'}]))

    def test_missing_effort_or_model_blocks(self):
        self.assertIsNotNone(delegate('terra'))
        self.assertIsNotNone(delegate('terra', [{'id': 'other', 'value': 'x'}]))
        self.assertIsNotNone(delegate(None, {'effort': 'low'}))

    def test_real_table_allows_swe_2_only_at_max(self):
        table = g.parse_table((ROOT / g.RULE).read_text(encoding='utf-8'))
        check = lambda level: g.check('mcp__t3-code__delegate_task', {'target': {
            'model': 'swe-2-high', 'options': [{'id': 'thought_level', 'value': level}]}}, table)
        self.assertIsNone(check('max'))
        self.assertIsNotNone(check('high'))

    def test_longest_model_name_wins(self):
        self.assertEqual(g.find_model(TABLE, 'swe-2-flash-medium')[0], 'swe-2-flash')


class MiscTest(unittest.TestCase):
    def test_other_tool_passes(self):
        self.assertIsNone(g.check('Bash', {'command': 'ls'}, TABLE))


class MainTest(unittest.TestCase):
    def run_main(self, stdin, **env):
        environment = {k: v for k, v in os.environ.items() if k != g.OVERRIDE} | env
        return subprocess.run([sys.executable, str(ROOT / 'tool/pstack/spawn_guard.py')],
                              input=stdin, capture_output=True, text=True, env=environment)

    def test_user_override_allows_a_model_outside_the_table(self):
        spawn = json.dumps({'tool_name': 'Agent', 'tool_input': {'model': 'fable', 'effort': 'high'}})
        self.assertEqual(self.run_main(spawn).returncode, 2)
        r = self.run_main(spawn, **{g.OVERRIDE: 'off'})
        self.assertEqual((r.returncode, r.stderr), (0, ''))

    def test_broken_json_fails_open(self):
        r = self.run_main('{not json')
        self.assertEqual(r.returncode, 0)
        self.assertIn('warning', r.stderr)

    def test_blocks_with_exit_2(self):
        r = self.run_main(json.dumps({'tool_name': 'Agent', 'tool_input': {'model': 'sonnet'}}))
        self.assertEqual(r.returncode, 2)

    def test_allows_a_listed_model_with_a_valid_effort(self):
        r = self.run_main(json.dumps({'tool_name': 'Agent', 'tool_input': {'model': 'sonnet', 'effort': 'low'}}))
        self.assertEqual((r.returncode, r.stderr), (0, ''))


class HookCommandTest(unittest.TestCase):
    """The hook in `.claude/settings.json` must never break a contributor without python3 or the script."""

    @staticmethod
    def command():
        settings = json.loads((ROOT / '.claude/settings.json').read_text(encoding='utf-8'))
        hooks = [h for entry in settings['hooks']['PreToolUse'] for h in entry['hooks']
                 if 'spawn_guard.py' in h['command']]
        assert len(hooks) == 1
        return hooks[0]['command']

    def run_hook(self, project_dir, path, stdin='{}'):
        env = {'CLAUDE_PROJECT_DIR': str(project_dir), 'PATH': str(path)}
        return subprocess.run(['/bin/sh', '-c', self.command()], input=stdin, env=env,
                              capture_output=True, text=True)

    def test_missing_python3_exits_silently(self):
        with tempfile.TemporaryDirectory() as empty:
            r = self.run_hook(ROOT, empty)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))

    def test_missing_script_exits_silently(self):
        with tempfile.TemporaryDirectory() as project:
            r = self.run_hook(project, os.environ['PATH'])
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))

    def test_present_script_still_blocks_with_exit_2(self):
        stdin = json.dumps({'tool_name': 'Agent', 'tool_input': {'model': 'sonnet'}})
        r = self.run_hook(ROOT, os.environ['PATH'], stdin)
        self.assertEqual(r.returncode, 2)


if __name__ == '__main__':
    unittest.main()
