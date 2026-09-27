import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from folder_export import FolderExporter


class FolderExportTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1] / '.verification'
        root.mkdir(exist_ok=True)
        self.directory = Path(tempfile.mkdtemp(prefix='folder-export-', dir=root))
        self.choose, self.auth = Mock(return_value=[str(self.directory)]), Mock()
        self.exporter = FolderExporter(self.choose, self.auth)
        self.png = b'\x89PNG\r\n\x1a\nsynthetic-test'
        self.payload = {'name': '测试/链接.zip', 'files': [
            {'name': '1.png', 'base64': base64.b64encode(self.png).decode()},
            {'name': '导出清单.json', 'base64': base64.b64encode(b'{"success":["1.png"]}').decode()},
        ]}

    def test_exports_png_and_manifest_without_overwriting_previous_export(self):
        first = self.exporter.export_image_folder(self.payload)
        second = self.exporter.export_image_folder(self.payload)
        self.assertNotEqual(first['directory'], second['directory'])
        target = Path(first['directory'])
        self.assertEqual(target.parent, self.directory)
        self.assertEqual((target / '1.png').read_bytes(), self.png)
        self.assertEqual(json.loads((target / '导出清单.json').read_bytes())['success'], ['1.png'])
        self.assertEqual(first['count'], 1)
        self.assertFalse(list(self.directory.rglob('*.zip')))

    def test_cancel_does_not_write(self):
        self.choose.return_value = None
        self.assertEqual(self.exporter.export_image_folder(self.payload), {'cancelled': True})
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_nested_link_images_and_windows_path_rejection(self):
        self.payload['files'][0]['name'] = '123_测试链接/配置清单图/123_配置1.png'
        result = self.exporter.export_image_folder(self.payload)
        self.assertEqual((Path(result['directory']) / self.payload['files'][0]['name']).read_bytes(), self.png)
        for name in ('../配置清单图/1.png', '链接/../1.png', '/图片/1.png', '链接/CON/1.png',
                     '链接/图片/1.png:stream', '链接/图片/1.png ', '链接/图片\\子目录/1.png'):
            self.payload['files'][0]['name'] = name
            with self.assertRaises(ValueError):
                self.exporter.export_image_folder(self.payload)

    def test_rejects_traversal_duplicate_and_invalid_png_before_prompt(self):
        for name in ('../1.png', 'C:\\1.png', '导出清单.json'):
            self.payload['files'][0]['name'] = name
            with self.assertRaises((ValueError, UnicodeDecodeError)):
                self.exporter.export_image_folder(self.payload)
        self.payload['files'][0] = {'name': '1.png', 'base64': 'eA=='}
        with self.assertRaises(ValueError):
            self.exporter.export_image_folder(self.payload)
        self.choose.assert_not_called()

    def test_expired_login_blocks_write_after_folder_selection(self):
        self.auth.side_effect = [None, RuntimeError('login expired')]
        with self.assertRaisesRegex(RuntimeError, 'login expired'):
            self.exporter.export_image_folder(self.payload)
        self.assertEqual(list(self.directory.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
