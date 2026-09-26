"""Bounded, credential-free progress events for model downloads."""
import time


class DownloadProgress:
    def __init__(self, item, report, clock=time.monotonic):
        self.item, self.report, self.clock = item, report, clock
        self.previous = None
        self.rate = 0

    def update(self, done, state='downloading'):
        now = self.clock()
        done = min(self.item['size'], max(0, int(done)))
        if self.previous:
            at, previous, phase = self.previous
            if state == phase and now - at < 1 and done < self.item['size']:
                return
            if done < previous:
                self.rate = 0  # A server ignored the resume range and restarted.
            elif now > at and state == phase == 'downloading':
                sample = (done - previous) / (now - at)
                self.rate = sample if not self.rate else .35 * sample + .65 * self.rate
        self.previous = (now, done, state)
        self.report({'path': self.item['path'], 'state': state, 'bytes_done': done,
                     'bytes_per_second': round(self.rate) if state == 'downloading' else 0,
                     'updated_at': time.time()})


def hub_progress_class(callback):
    from tqdm.auto import tqdm

    class ModelProgress(tqdm):
        def __init__(self, *args, **kwargs):
            name = kwargs.pop('name', '') or ''
            # Xet also creates a compressed-network-byte bar. Count reconstructed
            # file bytes only, so progress and remaining size share one unit.
            self.report_model = not (name.endswith('.transfer') or 'downloading bytes' in kwargs.get('desc', '').lower())
            kwargs['disable'] = False  # Track n even with console bars disabled.
            super().__init__(*args, **kwargs)
            if self.report_model:
                callback(self.n)

        def display(self, *args, **kwargs):
            return True  # Never print filenames, URLs, or progress to stdout.

        def update(self, n=1):
            result = super().update(n)
            if self.report_model:
                callback(self.n)
            return result

    return ModelProgress
