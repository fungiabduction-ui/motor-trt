import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve  # noqa: E402


def dose(eid='DOS-0001', at='2026-09-25T01:30:00-03:00', ml=0.08):
    return {'id': eid, 'tipo': 'dosis_t', 'at': at, 'ester': 'cipionato', 'mg': 16, 'ml': ml,
            'estado': 'confirmada', 'createdAt': at, 'updatedAt': at}


def log(rev=0, entries=None):
    return {'schema': 1, 'rev': rev, 'entries': entries if entries is not None else [dose()]}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = serve.Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def backups(self):
        return self.store.list_backups()

    def test_primer_guardado_crea_log_sin_backup(self):
        r = self.store.save_log(log(0))
        self.assertEqual(r['rev'], 1)
        self.assertIsNone(r['backup'])
        self.assertEqual(self.store.read_log()['rev'], 1)

    def test_segundo_guardado_respalda_la_version_anterior(self):
        self.store.save_log(log(0))
        doc = self.store.read_log()
        doc['entries'][0]['ml'] = 0.1
        r = self.store.save_log(doc)
        self.assertEqual(r['rev'], 2)
        prev = self.store.read_backup(r['backup'])
        self.assertEqual(prev['entries'][0]['ml'], 0.08)
        self.assertEqual(self.store.read_log()['entries'][0]['ml'], 0.1)

    def test_rev_desactualizado_da_conflicto_sin_tocar_disco(self):
        self.store.save_log(log(0))
        with self.assertRaises(serve.Conflict) as cm:
            self.store.save_log(log(0, [dose(ml=0.5)]))
        self.assertEqual(cm.exception.current_rev, 1)
        self.assertEqual(self.store.read_log()['entries'][0]['ml'], 0.08)

    def test_guardado_sin_cambios_no_escribe(self):
        self.store.save_log(log(0))
        r = self.store.save_log(self.store.read_log())
        self.assertTrue(r['unchanged'])
        self.assertEqual(r['rev'], 1)
        self.assertEqual(self.backups(), [])

    def test_invalidos_rechazados_sin_tocar_disco(self):
        self.store.save_log(log(0))
        malos = [
            {'schema': 2, 'rev': 1, 'entries': []},
            {'schema': 1, 'rev': '1', 'entries': []},
            log(1, [dose(eid='DOS-1')]),
            log(1, [dose(), dose()]),
            log(1, [{**dose(), 'tipo': 'farmaco'}]),
            log(1, [{**dose(), 'tipo': 'otro'}]),
            [],
        ]
        for m in malos:
            with self.subTest(m=m), self.assertRaises(serve.ValidationError):
                self.store.save_log(m)
        self.assertEqual(self.store.read_log()['rev'], 1)

    def test_serializacion_deterministica_y_ordenada(self):
        a = dose('DOS-0002', '2026-09-28T01:30:00-03:00')
        b = dose('DOS-0001', '2026-09-25T01:30:00-03:00')
        self.store.save_log(log(0, [a, b]))
        text = self.store.log_path.read_text(encoding='utf-8')
        self.assertLess(text.index('DOS-0001'), text.index('DOS-0002'))
        self.assertEqual(serve.serialize(self.store.read_log()), text)

    def test_restore_respalda_el_estado_actual(self):
        self.store.save_log(log(0))
        doc = self.store.read_log()
        doc['entries'][0]['ml'] = 0.1
        r2 = self.store.save_log(doc)
        r3 = self.store.restore(r2['backup'])
        self.assertEqual(r3['rev'], 3)
        self.assertEqual(self.store.read_log()['entries'][0]['ml'], 0.08)
        self.assertEqual(self.store.read_backup(r3['backup'])['entries'][0]['ml'], 0.1)
        self.assertEqual(len(self.backups()), 2)

    def test_backups_nunca_se_pisan_en_el_mismo_segundo(self):
        self.store.save_log(log(0))
        names = set()
        for i in range(3):
            doc = self.store.read_log()
            doc['entries'][0]['ml'] = 0.1 + i
            names.add(self.store.save_log(doc)['backup'])
        self.assertEqual(len(names), 3)

    def test_nombre_de_backup_con_path_traversal_rechazado(self):
        with self.assertRaises(serve.ValidationError):
            self.store.read_backup('../log.json')

    def test_errores_con_tope_de_200(self):
        for i in range(205):
            self.store.append_error({'modulo': 'test', 'mensaje': str(i)})
        errors = json.loads(self.store.errors_path.read_text(encoding='utf-8'))
        self.assertEqual(len(errors), 200)
        self.assertEqual(errors[-1]['mensaje'], '204')
        self.assertIn('ts', errors[-1])

    def test_error_que_no_es_objeto_rechazado(self):
        with self.assertRaises(serve.ValidationError):
            self.store.append_error(['no', 'objeto'])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.server = serve.make_server(self.tmp.name, port=0)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def req(self, method, path, body=None):
        data = json.dumps(body).encode('utf-8') if body is not None else None
        r = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', data=data, method=method,
                                   headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_log_inexistente_da_404_con_backups(self):
        status, body = self.req('GET', '/api/log')
        self.assertEqual(status, 404)
        self.assertEqual(body['error'], 'log_missing')
        self.assertEqual(body['backups'], [])

    def test_put_y_get(self):
        status, body = self.req('PUT', '/api/log', log(0))
        self.assertEqual((status, body['rev']), (200, 1))
        status, body = self.req('GET', '/api/log')
        self.assertEqual((status, body['rev']), (200, 1))

    def test_conflicto_409(self):
        self.req('PUT', '/api/log', log(0))
        status, body = self.req('PUT', '/api/log', log(0))
        self.assertEqual((status, body['error'], body['rev']), (409, 'conflict', 1))

    def test_invalido_400(self):
        status, body = self.req('PUT', '/api/log', {'schema': 9})
        self.assertEqual((status, body['error']), (400, 'invalid'))

    def test_backups_y_restore(self):
        self.req('PUT', '/api/log', log(0))
        _, cur = self.req('GET', '/api/log')
        cur['entries'][0]['ml'] = 0.1
        _, r = self.req('PUT', '/api/log', cur)
        status, lista = self.req('GET', '/api/backups')
        self.assertEqual((status, lista[0]['name']), (200, r['backup']))
        status, b = self.req('GET', '/api/backups/' + r['backup'])
        self.assertEqual((status, b['entries'][0]['ml']), (200, 0.08))
        status, rr = self.req('POST', '/api/restore/' + r['backup'])
        self.assertEqual((status, rr['rev']), (200, 3))

    def test_model_404_si_no_existe(self):
        status, body = self.req('GET', '/api/model')
        self.assertEqual((status, body['error']), (404, 'model_missing'))

    def test_errores(self):
        status, body = self.req('POST', '/api/errors', {'modulo': 'ui', 'mensaje': 'x'})
        self.assertEqual((status, body['ok']), (200, True))

    def test_ruta_api_desconocida_404(self):
        status, body = self.req('GET', '/api/nada')
        self.assertEqual((status, body['error']), (404, 'not_found'))

    def test_js_se_sirve_como_modulo(self):
        with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/js/engine/time.js') as resp:
            self.assertTrue(resp.headers['Content-Type'].startswith('text/javascript'))


if __name__ == '__main__':
    unittest.main()
