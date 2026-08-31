"""Subset of MicroPython urequests implemented by the browser fetch bridge."""

try:
    import ujson as _json
except ImportError:
    import json as _json

import simhw as _hw


class Response:
    def __init__(self, status_code, content, url=''):
        self.status_code = int(status_code)
        self.content = bytes(content)
        self.url = str(url)
        self.reason = ''
        self.headers = {}

    @property
    def text(self):
        return self.content.decode('utf-8')

    def json(self):
        return _json.loads(self.text)

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def request(method, url, data=None, json=None, headers=None, timeout=10, **kwargs):
    method = str(method).upper()
    if method != 'GET':
        raise NotImplementedError('Simulator Lite currently supports urequests GET only')
    timeout_ms = max(1, int(float(timeout) * 1000))
    result = list(_hw.http_request(method, str(url), timeout_ms))
    return Response(result[0], result[1], str(url))


def get(url, **kwargs):
    return request('GET', url, **kwargs)
