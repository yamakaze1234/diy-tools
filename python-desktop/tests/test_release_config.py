import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from io import BytesIO
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_config import configure_local_app, read_config, verify_local_runtime


class ReleaseConfigTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1] / '.verification'
        self.root.mkdir(exist_ok=True)
        self.stage = Path(tempfile.mkdtemp(prefix='release-config-', dir=self.root))
        self.old, self.new = self.stage / 'old', self.stage / 'new'
        self.config = dict(envId='synthetic-env', region='ap-shanghai', functionName='workbenchApi', accessKey='synthetic-public-key')
        for app in (self.old, self.new):
            (app / '_internal/web').mkdir(parents=True)
        self.write(self.old, self.config)
        self.write(self.new, {**self.config, 'envId': 'your-cloudbase-env-id'})

    def write(self, app, value):
        (app / '_internal/web/.env.local').write_text('CLOUDBASE_PUBLIC_CONFIG=' + json.dumps(value), encoding='utf-8')

    def test_preserve_real_config_without_creating_data(self):
        configure_local_app(self.new, self.old)
        self.assertEqual(read_config(self.new), self.config)
        self.assertFalse((self.new / 'data').exists())
        self.assertEqual(read_config(self.old), self.config)

    def test_placeholder_source_rejected_before_target_changes(self):
        self.write(self.old, {**self.config, 'envId': 'your-cloudbase-env-id'})
        before = (self.new / '_internal/web/.env.local').read_bytes()
        with self.assertRaisesRegex(ValueError, '示例配置'):
            configure_local_app(self.new, self.old)
        self.assertEqual((self.new / '_internal/web/.env.local').read_bytes(), before)

    def test_running_config_must_match_real_config(self):
        configure_local_app(self.new, self.old)
        runtime = self.new / 'data/runtime'
        runtime.mkdir(parents=True)
        (runtime / 'desktop-runtime.json').write_text(json.dumps(dict(port=1234, version='test')), encoding='utf-8')
        with patch('release_config.urlopen', return_value=BytesIO(json.dumps({'config': self.config}).encode())):
            self.assertTrue(verify_local_runtime(self.new)['cloudConfigVerified'])
        with patch('release_config.urlopen', return_value=BytesIO(json.dumps({'config': {**self.config, 'envId': 'other-env'}}).encode())):
            with self.assertRaisesRegex(ValueError, '不一致'):
                verify_local_runtime(self.new)

    def test_public_zip_is_sealed_before_local_config_is_restored(self):
        import package
        root = self.stage / 'project/python-desktop'
        (root / 'verification').mkdir(parents=True)
        (root.parent / 'prototype').mkdir()
        (root.parent / 'docs').mkdir()
        (root.parent / 'release').mkdir()
        template = (self.new / '_internal/web/.env.local').read_bytes()
        (root.parent / 'prototype/.env.example').write_bytes(template)
        (root / '使用说明.txt').write_text('test', encoding='utf-8')
        (root.parent / 'docs/DIY配置工作台-零基础完整说明书.html').write_text('test', encoding='utf-8')
        (self.new / 'app.exe').write_bytes(b'synthetic-exe')
        (self.new / 'MicrosoftEdgeWebview2Setup.exe').write_bytes(b'synthetic-installer')
        (self.new / '_internal/web/seed.json').write_text(json.dumps({k: [] for k in ('configs', 'templates', 'sourceCatalog', 'costSource', 'caseGallery', 'logs')}), encoding='utf-8')
        (root / 'verification/latest-build.json').write_text(json.dumps(dict(version='test', directory=str(self.new), executable=str(self.new / 'app.exe'), previousDirectory=str(self.old))), encoding='utf-8')
        with patch.object(package, 'ROOT', root):
            package.package()
        self.assertEqual(read_config(self.new), self.config)
        self.assertFalse((self.new / 'data').exists())
        with zipfile.ZipFile(root.parent / 'release/DIY配置工作台-vtest-其他电脑使用.zip') as archive:
            self.assertEqual(archive.read('new/_internal/web/.env.local'), template)
        report = json.loads((root / 'verification/release-test.json').read_text(encoding='utf-8'))
        self.assertTrue(report['localCloudConfig']['configured'])


if __name__ == '__main__':
    unittest.main()
