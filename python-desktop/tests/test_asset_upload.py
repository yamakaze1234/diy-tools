import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cloud import Cloud
from common import AppError, digest


def response(status, content=b''):
    value = requests.Response()
    value.status_code = status
    value._content = content
    value._content_consumed = True
    return value


class AssetUploadTests(unittest.TestCase):
    def setUp(self):
        self.data = b'synthetic original image'
        self.name = digest(self.data) + '.png'
        self.values = {'workspaceId': 'synthetic-workspace'}
        self.cloud = Cloud.__new__(Cloud)
        self.cloud.s = SimpleNamespace(
            lock=threading.RLock(), config={'envId': 'synthetic-env'},
            store=SimpleNamespace(meta=self.values.get, set_meta=self.values.__setitem__))
        self.cloud.token = 'synthetic-token'
        self.cloud.epoch = 0
        self.cloud.stopping = threading.Event()
        self.cloud.download_asset = Mock(return_value=self.data)
        self.state = {'configs': [{'image': '/uploads/' + self.name}]}

    def upload(self):
        self.cloud.upload_assets(self.state, self.cloud.token)

    def test_existing_remote_image_is_verified_without_reupload(self):
        with patch('cloud.requests.get', return_value=response(200, self.data)), patch('cloud.requests.post') as post:
            self.upload()
        post.assert_not_called()
        self.assertEqual(self.values['uploadedAssets'], [self.name])

    def test_missing_remote_image_uploads_once(self):
        with patch('cloud.requests.get', return_value=response(404)), patch('cloud.requests.post', return_value=response(200)) as post:
            self.upload()
        self.assertEqual(post.call_count, 1)
        self.assertEqual(post.call_args.kwargs['data'], self.data)
        self.assertEqual(self.values['uploadedAssets'], [self.name])

    def test_timeout_after_success_is_confirmed_by_readback(self):
        with patch('cloud.requests.get', side_effect=[response(404), response(200, self.data)]), patch('cloud.requests.post', side_effect=requests.ReadTimeout('private detail')) as post:
            self.upload()
        self.assertEqual(post.call_count, 1)
        self.assertEqual(self.values['uploadedAssets'], [self.name])

    def test_timeout_without_remote_image_keeps_unconfirmed(self):
        with patch('cloud.requests.get', return_value=response(404)), patch('cloud.requests.post', side_effect=requests.ReadTimeout('private detail')):
            with self.assertRaisesRegex(AppError, '网络超时') as result:
                self.upload()
        self.assertNotIn('private detail', str(result.exception))
        self.assertNotIn('uploadedAssets', self.values)

    def test_failed_readback_does_not_mark_confirmed(self):
        with patch('cloud.requests.get', side_effect=[response(404), requests.ConnectionError('private detail')]), patch('cloud.requests.post', side_effect=requests.ReadTimeout()):
            with self.assertRaisesRegex(AppError, '连接中断'):
                self.upload()
        self.assertNotIn('uploadedAssets', self.values)

    def test_mismatch_does_not_overwrite_remote_image(self):
        with patch('cloud.requests.get', return_value=response(200, b'wrong bytes')), patch('cloud.requests.post') as post:
            with self.assertRaisesRegex(AppError, '校验不一致'):
                self.upload()
        post.assert_not_called()
        self.assertNotIn('uploadedAssets', self.values)

    def test_permission_failure_is_not_treated_as_missing(self):
        with patch('cloud.requests.get', return_value=response(403)), patch('cloud.requests.post') as post:
            with self.assertRaisesRegex(AppError, 'HTTP 403'):
                self.upload()
        post.assert_not_called()
        self.assertNotIn('uploadedAssets', self.values)

    def test_concurrent_upload_conflict_is_confirmed(self):
        with patch('cloud.requests.get', side_effect=[response(404), response(200, self.data)]), patch('cloud.requests.post', return_value=response(409)):
            self.upload()
        self.assertEqual(self.values['uploadedAssets'], [self.name])

    def test_changed_login_cannot_mark_new_member_uploaded(self):
        def changed(*args, **kwargs):
            self.cloud.epoch += 1
            return response(200, self.data)
        with patch('cloud.requests.get', side_effect=changed), patch('cloud.requests.post') as post:
            with self.assertRaisesRegex(AppError, '同步已停止'):
                self.upload()
        post.assert_not_called()
        self.assertNotIn('uploadedAssets', self.values)

    def test_confirmed_local_receipt_skips_network(self):
        self.values['uploadedAssets'] = [self.name]
        with patch('cloud.requests.get') as get, patch('cloud.requests.post') as post:
            self.upload()
        get.assert_not_called()
        post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
