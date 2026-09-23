import tempfile
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cache_cleanup import preview, clear


class CacheCleanupTests(unittest.TestCase):
    def test_only_superseded_generated_images_are_recycled(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for name in ('intel_a_r1_long_light.png', 'intel_a_r2_long_light.png',
                         'intel_a_r1_square_light.png', 'intel_b_r1_long_light.png',
                         'customer-image.png'):
                (folder / name).write_bytes(b'image')
            plan = preview(folder)
            self.assertEqual(plan['count'], 1)
            recycled = []
            result = clear(folder, plan['signature'], lambda path: recycled.extend(p.name for p in path.iterdir()))
            self.assertEqual(result['removed'], 1)
            self.assertEqual(recycled, ['intel_a_r1_long_light.png'])
            for name in ('intel_a_r2_long_light.png', 'intel_a_r1_square_light.png',
                         'intel_b_r1_long_light.png', 'customer-image.png'):
                self.assertTrue((folder / name).exists())

    def test_recycle_failure_restores_original_files(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            old = folder / 'intel_a_r1_long_light.png'
            old.write_bytes(b'old')
            (folder / 'intel_a_r2_long_light.png').write_bytes(b'new')
            def fail(_):
                raise RuntimeError('recycle unavailable')
            with self.assertRaisesRegex(RuntimeError, 'recycle unavailable'):
                clear(folder, preview(folder)['signature'], fail)
            self.assertEqual(old.read_bytes(), b'old')
            self.assertEqual(len(list(folder.iterdir())), 2)
