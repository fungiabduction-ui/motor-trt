#!/usr/bin/env python3
"""
Motor TRT — servidor local.
Uso:  python serve.py [puerto]      (default 8735, escucha solo en 127.0.0.1)

Sirve la app y persiste data/log.json. Cada guardado: validación → backup inmutable de la versión
anterior en data/backups/ → escritura atómica (archivo temporal + os.replace). Spec §4.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
import threading
import traceback
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8735
SCHEMA = 1
MAX_BODY = 5 * 1024 * 1024
ERRORS_CAP = 200
TIPO_PREFIX = {'dosis_t': 'DOS', 'farmaco': 'FAR', 'esquema': 'ESQ', 'sintoma': 'SIN', 'lab': 'LAB'}
ID_RE = re.compile(r'^(DOS|FAR|ESQ|SIN|LAB)-\d{4}$')
BACKUP_RE = re.compile(r'^log_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.json$')


class ValidationError(Exception):
    pass


class Conflict(Exception):
    def __init__(self, current_rev: int):
        super().__init__(f'rev desactualizado (en disco: {current_rev})')
        self.current_rev = current_rev


def validate_log(doc) -> None:
    if not isinstance(doc, dict):
        raise ValidationError('el log debe ser un objeto JSON')
    if doc.get('schema') != SCHEMA:
        raise ValidationError(f'schema debe ser {SCHEMA}')
    rev = doc.get('rev')
    if not isinstance(rev, int) or isinstance(rev, bool):
        raise ValidationError('rev debe ser un entero')
    entries = doc.get('entries')
    if not isinstance(entries, list):
        raise ValidationError('entries debe ser una lista')
    seen = set()
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            raise ValidationError(f'entrada {i}: no es un objeto')
        eid, tipo = e.get('id'), e.get('tipo')
        if not isinstance(eid, str) or not ID_RE.match(eid):
            raise ValidationError(f'entrada {i}: id inválido {eid!r}')
        if tipo not in TIPO_PREFIX:
            raise ValidationError(f'{eid}: tipo desconocido {tipo!r}')
        if not eid.startswith(TIPO_PREFIX[tipo] + '-'):
            raise ValidationError(f'{eid}: el prefijo no corresponde al tipo {tipo}')
        if eid in seen:
            raise ValidationError(f'{eid}: id duplicado')
        seen.add(eid)


def _sort_key(entry: dict):
    return (entry.get('at') or entry.get('desde') or '', entry['id'])


def serialize(doc: dict) -> str:
    """Serialización determinística: mismas entradas → mismo archivo, byte a byte."""
    out = dict(doc)
    out['entries'] = sorted(doc['entries'], key=_sort_key)
    return json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + '\n'


class Store:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
        self.log_path = self.data_dir / 'log.json'
        self.model_path = self.data_dir / 'model.json'
        self.errors_path = self.data_dir / 'errors.json'
        self.backups_dir = self.data_dir / 'backups'
        self._lock = threading.Lock()

    @staticmethod
    def _read_json(path: Path):
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding='utf-8'))

    def read_log(self):
        return self._read_json(self.log_path)

    def read_model(self):
        return self._read_json(self.model_path)

    def _atomic_write(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + '.tmp')
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)

    def _backup_current(self):
        """Copia el log vigente a backups/ con timestamp. Nunca pisa un backup existente ('xb')."""
        if not self.log_path.exists():
            return None
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        base = datetime.datetime.now().strftime('log_%Y-%m-%d_%H-%M-%S')
        data = self.log_path.read_bytes()
        n = 1
        while True:
            name = f'{base}.json' if n == 1 else f'{base}_{n}.json'
            try:
                with open(self.backups_dir / name, 'xb') as f:
                    f.write(data)
                return name
            except FileExistsError:
                n += 1

    def save_log(self, doc) -> dict:
        validate_log(doc)
        with self._lock:
            current = self.read_log()
            current_rev = current['rev'] if current else 0
            if doc['rev'] != current_rev:
                raise Conflict(current_rev)
            if current is not None and serialize({**doc, 'rev': current_rev}) == serialize(current):
                return {'rev': current_rev, 'unchanged': True, 'backup': None}
            new = {**doc, 'rev': current_rev + 1}
            backup = self._backup_current()
            self._atomic_write(self.log_path, serialize(new))
            return {'rev': new['rev'], 'unchanged': False, 'backup': backup}

    def list_backups(self) -> list:
        if not self.backups_dir.exists():
            return []
        out = []
        for p in sorted(self.backups_dir.iterdir(), reverse=True):
            if not BACKUP_RE.match(p.name):
                continue
            try:
                doc = json.loads(p.read_text(encoding='utf-8'))
                n, rev = len(doc.get('entries', [])), doc.get('rev')
            except (ValueError, OSError):
                n, rev = None, None
            out.append({'name': p.name, 'size': p.stat().st_size, 'entries': n, 'rev': rev})
        return out

    def read_backup(self, name: str):
        if not BACKUP_RE.match(name):
            raise ValidationError('nombre de backup inválido')
        path = self.backups_dir / name
        if not path.exists():
            raise FileNotFoundError(name)
        return json.loads(path.read_text(encoding='utf-8'))

    def restore(self, name: str) -> dict:
        doc = self.read_backup(name)
        validate_log(doc)
        with self._lock:
            current = self.read_log()
            current_rev = current['rev'] if current else 0
            backup = self._backup_current()
            new = {**doc, 'rev': current_rev + 1}
            self._atomic_write(self.log_path, serialize(new))
            return {'rev': new['rev'], 'backup': backup, 'restored': name}

    def append_error(self, entry) -> None:
        if not isinstance(entry, dict):
            raise ValidationError('el error debe ser un objeto')
        with self._lock:
            try:
                errors = self._read_json(self.errors_path) or []
            except ValueError:
                errors = []
            errors.append({**entry, 'ts': datetime.datetime.now().astimezone().isoformat(timespec='seconds')})
            self._atomic_write(self.errors_path, json.dumps(errors[-ERRORS_CAP:], ensure_ascii=False, indent=2) + '\n')


class Handler(SimpleHTTPRequestHandler):
    # En Windows el registro puede mapear .js a text/plain y el navegador rechaza los módulos ES.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.json': 'application/json', '.css': 'text/css'}

    def __init__(self, *args, store: Store, **kwargs):
        self.store = store
        super().__init__(*args, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))

    def _json(self, status: int, obj) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValidationError('cuerpo vacío o demasiado grande')
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except (ValueError, UnicodeDecodeError) as e:
            raise ValidationError(f'JSON inválido: {e}')

    def _route(self, method: str) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if method == 'GET' and path == '/api/log':
                doc = self.store.read_log()
                if doc is None:
                    return self._json(404, {'error': 'log_missing',
                                            'backups': [b['name'] for b in self.store.list_backups()]})
                return self._json(200, doc)
            if method == 'PUT' and path == '/api/log':
                return self._json(200, self.store.save_log(self._body()))
            if method == 'GET' and path == '/api/model':
                model = self.store.read_model()
                return self._json(200, model) if model is not None else self._json(404, {'error': 'model_missing'})
            if method == 'GET' and path == '/api/backups':
                return self._json(200, self.store.list_backups())
            if method == 'GET' and path.startswith('/api/backups/'):
                return self._json(200, self.store.read_backup(path[len('/api/backups/'):]))
            if method == 'POST' and path.startswith('/api/restore/'):
                return self._json(200, self.store.restore(path[len('/api/restore/'):]))
            if method == 'POST' and path == '/api/errors':
                self.store.append_error(self._body())
                return self._json(200, {'ok': True})
            return self._json(404, {'error': 'not_found'})
        except Conflict as e:
            return self._json(409, {'error': 'conflict', 'rev': e.current_rev})
        except ValidationError as e:
            return self._json(400, {'error': 'invalid', 'detail': str(e)})
        except FileNotFoundError as e:
            return self._json(404, {'error': 'not_found', 'detail': str(e)})
        except Exception as e:  # noqa: BLE001 — cualquier fallo queda registrado para revisarlo en sesión
            try:
                self.store.append_error({'modulo': 'serve.py', 'accion': f'{method} {path}',
                                         'mensaje': str(e), 'stack': traceback.format_exc()})
            except Exception:  # noqa: BLE001
                pass
            return self._json(500, {'error': 'server', 'detail': str(e)})

    def do_GET(self):
        if urlparse(self.path).path.startswith('/api/'):
            return self._route('GET')
        return super().do_GET()

    def do_PUT(self):
        return self._route('PUT')

    def do_POST(self):
        return self._route('POST')


def make_server(data_dir, port: int = DEFAULT_PORT, host: str = '127.0.0.1', root: Path = ROOT):
    handler = partial(Handler, store=Store(data_dir), directory=str(root))
    return ThreadingHTTPServer((host, port), handler)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = make_server(ROOT / 'data', port)
    url = f'http://127.0.0.1:{port}'
    print(f'\n  MOTOR TRT — servidor local\n  Carpeta: {ROOT}\n  URL:     {url}\n  CTRL+C para detener.\n', flush=True)
    if not (ROOT / 'data' / 'log.json').exists():
        print('  ⚠ data/log.json no existe. Si es la primera vez: node tools/migrate.mjs\n'
              '    Si ya existía: restaurá el último backup desde la app (pestaña Respaldos).\n', flush=True)
    try:
        webbrowser.open_new_tab(url)
    except Exception:  # noqa: BLE001
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Servidor detenido.')


if __name__ == '__main__':
    main()
