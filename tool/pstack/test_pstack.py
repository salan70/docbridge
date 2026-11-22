"""Offline tests for pstack.py. They use a temporary repository and never touch the network.

Origin: adapted from the repository owner's tests in another project. Covered by this repository's LICENSE.
"""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pstack

LICENSE = b'MIT license fixture'
SKILL = b'---\nname: how\n---\nupstream body\n'
MODE = b'---\nname: poteto-mode\n---\nmode body\n'


def sha(body):
    return hashlib.sha256(body).hexdigest()


class InstallTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repo = Path(directory.name)
        self.upstream = {'pstack/LICENSE': LICENSE, 'pstack/skills/how/SKILL.md': SKILL,
                         'pstack/skills/poteto-mode/SKILL.md': MODE}
        (self.repo / 'overlays').mkdir()
        (self.repo / 'overlays/poteto-mode.md').write_text('## Project overrides\nlocal rule\n')
        self.data = {
            'pin': 'a' * 40,
            'install': {'pstack/LICENSE': 'upstream/LICENSE',
                        'pstack/skills/how/': 'skills/how/',
                        'pstack/skills/poteto-mode/': 'skills/poteto-mode/'},
            'exclude': ['pstack/skills/poteto-mode/scripts/'],
            'overlays': {'pstack/skills/poteto-mode/SKILL.md': 'overlays/poteto-mode.md'},
            'files': {name: sha(body) for name, body in self.upstream.items()},
        }
        self.write_manifest()
        for target in ('ROOT', 'REPO'):
            patcher = patch.object(pstack, target, self.repo)
            patcher.start()
            self.addCleanup(patcher.stop)
        fetch = patch.object(pstack, 'fetch', side_effect=lambda pin, name: self.upstream[name])
        self.fetch = fetch.start()
        self.addCleanup(fetch.stop)

    def write_manifest(self):
        (self.repo / 'manifest.json').write_text(json.dumps(self.data))

    def test_sync_installs_files_and_appends_overlay(self):
        self.assertFalse(pstack.status()['valid'])
        result = pstack.sync()
        self.assertTrue(result['valid'], result)
        self.assertEqual((self.repo / 'skills/how/SKILL.md').read_bytes(), SKILL)
        mode = (self.repo / 'skills/poteto-mode/SKILL.md').read_text()
        self.assertTrue(mode.startswith(MODE.decode()))
        self.assertIn('pstack project overlay: overlays/poteto-mode.md', mode)
        self.assertTrue(mode.endswith('local rule\n'))

    def test_sync_skips_verified_files(self):
        pstack.sync()
        self.fetch.reset_mock()
        pstack.sync()
        self.fetch.assert_not_called()

    def test_edit_to_upstream_part_is_detected_and_repaired(self):
        pstack.sync()
        target = self.repo / 'skills/poteto-mode/SKILL.md'
        target.write_text(target.read_text().replace('mode body', 'edited body'))
        self.assertEqual(pstack.status()['invalid'], ['pstack/skills/poteto-mode/SKILL.md'])
        self.assertTrue(pstack.sync()['valid'])

    def test_overlay_change_requires_sync(self):
        pstack.sync()
        (self.repo / 'overlays/poteto-mode.md').write_text('## Project overrides\nnew rule\n')
        self.assertFalse(pstack.status()['valid'])
        pstack.sync()
        self.assertIn('new rule', (self.repo / 'skills/poteto-mode/SKILL.md').read_text())

    def test_stale_file_in_managed_directory_is_removed(self):
        pstack.sync()
        stale = self.repo / 'skills/how/old.md'
        stale.write_text('removed upstream')
        self.assertEqual(pstack.status()['stale'], ['skills/how/old.md'])
        self.assertTrue(pstack.sync()['valid'])
        self.assertFalse(stale.exists())

    def test_checksum_mismatch_writes_nothing(self):
        self.upstream['pstack/skills/how/SKILL.md'] = b'tampered'
        with self.assertRaises(ValueError):
            pstack.sync()
        self.assertFalse((self.repo / 'skills/how/SKILL.md').exists())
        self.assertFalse((self.repo / 'upstream/LICENSE').exists())

    def test_excluded_and_unmapped_paths_are_rejected(self):
        for name in ('pstack/skills/poteto-mode/scripts/run.ts', 'pstack/skills/ketchup/SKILL.md'):
            self.data['files'][name] = 'b' * 64
            self.write_manifest()
            with self.assertRaises(ValueError):
                pstack.manifest()
            del self.data['files'][name]

    def test_unsafe_paths_and_links_are_rejected(self):
        self.data['install']['pstack/skills/why/'] = '../outside/'
        self.data['files']['pstack/skills/why/SKILL.md'] = 'b' * 64
        self.write_manifest()
        with self.assertRaises(ValueError):
            pstack.manifest()
        del self.data['install']['pstack/skills/why/'], self.data['files']['pstack/skills/why/SKILL.md']
        self.write_manifest()
        (self.repo / 'elsewhere').mkdir()
        (self.repo / 'skills').mkdir()
        (self.repo / 'skills/how').symlink_to(self.repo / 'elsewhere')
        with self.assertRaises(ValueError):
            pstack.manifest()

    def test_license_is_required(self):
        del self.data['install']['pstack/LICENSE']
        self.write_manifest()
        with self.assertRaises(ValueError):
            pstack.manifest()

    def test_propose_update_lists_changes_without_touching_manifest(self):
        before = (self.repo / 'manifest.json').read_text()
        self.upstream['pstack/skills/how/SKILL.md'] = b'new upstream'
        self.upstream['pstack/skills/how/references/new.md'] = b'added'
        tree = [*self.upstream, 'pstack/skills/ketchup/SKILL.md', 'pstack/skills/poteto-mode/scripts/x.ts']
        with patch.object(pstack, 'upstream_tree', return_value=tree):
            result = pstack.propose_update('c' * 40, self.repo / 'candidate.json')
        self.assertEqual(result['added'], ['pstack/skills/how/references/new.md'])
        self.assertEqual(result['changed'], ['pstack/skills/how/SKILL.md'])
        self.assertEqual(result['removed'], [])
        candidate = json.loads((self.repo / 'candidate.json').read_text())
        self.assertEqual(candidate['pin'], 'c' * 40)
        self.assertEqual(candidate['overlays'], self.data['overlays'])
        self.assertEqual((self.repo / 'manifest.json').read_text(), before)
        with self.assertRaises(ValueError):
            pstack.propose_update('main', self.repo / 'other.json')


class RepositoryManifestTest(unittest.TestCase):
    def test_committed_manifest_is_well_formed_and_installed_files_match(self):
        data = pstack.manifest()
        self.assertTrue(data['files'])
        self.assertTrue(pstack.status(data)['valid'])


if __name__ == '__main__':
    unittest.main()
