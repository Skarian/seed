"""Offline compatibility checks; no GPU, network or private state required."""
import importlib.util
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('seed_vast_worker', Path(__file__).with_name('worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
REPO = Path(os.environ.get('SEED_REPO', Path.cwd()))


class EntrypointTests(unittest.TestCase):
    def test_current_entrypoint_becomes_loopback_and_is_repeatable(self):
        source = (REPO / 'worker/run.py').read_text()
        adapted = worker.prepare_entrypoint(source)
        compile(adapted, 'adapted-run.py', 'exec')
        self.assertEqual(adapted, worker.prepare_entrypoint(adapted))
        self.assertNotIn("host='0.0.0.0', port=8080", adapted)
        self.assertNotIn("'--ip=0.0.0.0'", adapted)

    def test_unknown_image_fails_instead_of_loosening_security(self):
        with self.assertRaises(ValueError):
            worker.prepare_entrypoint('print("a different worker")')

    def test_ambiguous_entrypoint_fails(self):
        source = (REPO / 'worker/run.py').read_text()
        with self.assertRaises(ValueError):
            worker.prepare_entrypoint(source + '\n' + source)


if __name__ == '__main__':
    unittest.main()
