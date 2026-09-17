import base64
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from common import atomic, dumps, digest
from storage_paths import storage_paths, prepare_storage
from credentials import Credentials, dpapi


class PortableStorageTests(unittest.TestCase):
    def setUp(self):
        (ROOT / '.verification').mkdir(exist_ok=True)
        self.temp = Path(tempfile.mkdtemp(prefix='portable-', dir=ROOT / '.verification'))
        self.exe = self.temp / 'app' / 'workbench.exe'
        self.paths = storage_paths({'APPDATA': str(self.temp / 'roaming')}, frozen=True, executable=self.exe)

    def legacy(self):
        source = self.paths.legacy_profile / 'data'
        source.mkdir(parents=True)
        atomic(source / 'state.json', dumps(dict(revision=17, configs=[dict(id='preserved')], templates=[])))
        atomic(source / 'assets' / 'photo.png', b'original-image')
        return source

    def test_frozen_uses_executable_folder_not_cwd_or_internal(self):
        self.assertEqual(self.paths.data, self.exe.parent / 'data')
        self.assertEqual(self.paths.profile, self.exe.parent / 'data/runtime')
        dev = storage_paths({}, frozen=False, source=ROOT / 'main.py')
        self.assertEqual(dev.data, ROOT / 'data')

    def test_import_preserves_original_and_sqlite_wal(self):
        source = self.legacy()
        db = sqlite3.connect(source / 'workspace.sqlite')
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE pending(value TEXT)')
        db.execute("INSERT INTO pending VALUES('unsynced')")
        db.commit()
        check = Mock()
        try:
            self.assertTrue(prepare_storage(self.paths, check))
            with sqlite3.connect(self.paths.data / 'workspace.sqlite') as migrated:
                self.assertEqual(migrated.execute('SELECT value FROM pending').fetchone()[0], 'unsynced')
            self.assertEqual((source / 'state.json').read_bytes(), (self.paths.data / 'state.json').read_bytes())
            self.assertEqual((self.paths.data / 'assets/photo.png').read_bytes(), b'original-image')
            self.assertTrue(source.exists())
            self.assertTrue((self.paths.data / 'portable-migration.json').exists())
            check.assert_called_once_with(self.paths.legacy_profile)
        finally:
            db.close()

    def test_existing_data_is_never_overwritten_or_reimported(self):
        source = self.legacy()
        atomic(self.paths.data / 'state.json', '{"revision":99}')
        check = Mock()
        self.assertFalse(prepare_storage(self.paths, check))
        self.assertEqual(json.loads((self.paths.data / 'state.json').read_text())['revision'], 99)
        check.assert_not_called()

    def test_running_old_app_blocks_import_without_creating_target(self):
        self.legacy()
        with self.assertRaisesRegex(RuntimeError, 'active'):
            prepare_storage(self.paths, Mock(side_effect=RuntimeError('active')))
        self.assertFalse(self.paths.data.exists())

    def test_explicit_test_directory_does_not_import_user_data(self):
        self.legacy()
        paths = storage_paths({'APPDATA': str(self.temp / 'roaming'), 'DIY_WORKBENCH_DATA_DIR': str(self.temp / 'isolated')}, frozen=True, executable=self.exe)
        self.assertFalse(prepare_storage(paths, Mock(side_effect=AssertionError('must not probe legacy'))))
        self.assertFalse((paths.data / 'state.json').exists())

    def test_legacy_electron_sql_key_remains_readable_after_folder_migration(self):
        source = self.legacy()
        member = dumps(['synthetic-team', 'A'])
        owner = digest(member)
        key, nonce = os.urandom(32), os.urandom(12)
        config = dict(server='synthetic', port=1433, database='test', user='reader', encrypt=True, trustServerCertificate=True)
        plain = dumps(dict(version=1, owner=owner, settings=config, password='synthetic-secret')).encode()
        ciphertext = b'v10' + nonce + AESGCM(key).encrypt(nonce, plain, None)
        atomic(source / 'sql-credentials' / (owner + '.json'), dumps(dict(version=1, owner=owner, saved=True, protection='electron-safe-storage-v1', ciphertext=base64.b64encode(ciphertext).decode())))
        atomic(self.paths.legacy_profile / 'Local State', dumps(dict(os_crypt=dict(encrypted_key=base64.b64encode(b'DPAPI' + dpapi(key, encrypt=True)).decode()), unrelated='not copied')))
        prepare_storage(self.paths, Mock())
        self.assertEqual(Credentials(self.paths.data).read(member)['password'], 'synthetic-secret')
        self.assertFalse((self.paths.data / 'Local State').exists())
        self.assertNotIn('unrelated', (self.paths.data / 'sql-credentials/legacy-os-crypt.json').read_text())
