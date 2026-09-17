"""Serialization and atomic storage shared by the Python services."""
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def uid():
    return str(uuid.uuid4())


def digest(value):
    if not isinstance(value, (str, bytes)):
        value = dumps(value)
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def atomic(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    pending = file.with_name(file.name + '.pending')
    with open(pending, 'wb') as stream:
        stream.write(data.encode('utf-8') if isinstance(data, str) else data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, file)


class AppError(Exception):
    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.status, self.code = status, code
