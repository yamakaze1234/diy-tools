import unittest
from download_notify import watch_download


class Event:
    def __init__(self):
        self.handlers = []
    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self
    def __isub__(self, handler):
        self.handlers.remove(handler)
        return self


class Operation:
    def __init__(self, state='InProgress'):
        self.State = state
        self.ResultFilePath = 'test.zip'
        self.StateChanged = Event()
    def change(self, state):
        self.State = state
        for handler in self.StateChanged.handlers[:]:
            handler(self, None)


class DownloadNotificationTests(unittest.TestCase):
    def test_complete_notifies_once_and_unsubscribes(self):
        op, notices = Operation(), []
        watch_download(op, notices.append)
        self.assertEqual(notices, [])
        op.change('Completed')
        self.assertEqual(notices, ['test.zip'])
        self.assertEqual(op.StateChanged.handlers, [])

    def test_interrupted_does_not_notify(self):
        op, notices = Operation(), []
        watch_download(op, notices.append)
        op.change('Interrupted')
        self.assertEqual(notices, [])
        self.assertEqual(op.StateChanged.handlers, [])

    def test_already_completed(self):
        notices = []
        watch_download(Operation('Completed'), notices.append)
        self.assertEqual(notices, ['test.zip'])
