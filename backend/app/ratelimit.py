"""Per-IP rate limit of contact submissions (in memory only).

A sliding window: for every IP the limiter keeps the timestamps of its requests that
lie inside the window. Nothing is persisted. On every call, timestamps older than the
window are purged and an IP whose newest request is older than the window is dropped
entirely, so no IP is held longer than ``window_seconds`` (10 minutes by default)
after its last request. IPs are never logged.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable

MAX_REQUESTS = 5
WINDOW_SECONDS = 600.0


class RateLimiter:
    """Allows at most ``max_requests`` per key within ``window_seconds``."""

    def __init__(
        self,
        max_requests: int = MAX_REQUESTS,
        window_seconds: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_requests < 1:
            raise ValueError("max_requests must be at least 1")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.clock = clock
        self._requests: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        """Drop timestamps outside the window and IPs with nothing left in it.

        Caller holds the lock.
        """
        cutoff = now - self.window_seconds
        for key in list(self._requests):
            stamps = self._requests[key]
            while stamps and stamps[0] <= cutoff:
                stamps.popleft()
            if not stamps:
                del self._requests[key]

    def allow(self, key: str) -> bool:
        """Record one request of ``key``; True when it is within the limit.

        A denied request is recorded too, so a client that keeps sending stays
        blocked until it has been quiet for a whole window.
        """
        with self._lock:
            now = self.clock()
            self._purge(now)
            stamps = self._requests.setdefault(key, deque())
            stamps.append(now)
            # Bound the memory per IP: only the newest max_requests + 1 stamps matter.
            while len(stamps) > self.max_requests + 1:
                stamps.popleft()
            return len(stamps) <= self.max_requests

    def hit(self, key: str) -> bool:
        """Same as ``allow`` (the name the sprint's shared interface uses)."""
        return self.allow(key)

    def tracked_ips(self) -> int:
        """How many keys are currently held in memory (after purging stale ones)."""
        with self._lock:
            self._purge(self.clock())
            return len(self._requests)

    def reset(self) -> None:
        """Forget every key (used by tests to start from a clean state)."""
        with self._lock:
            self._requests.clear()


_rate_limiter = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    """The process-wide rate limiter shared by every request."""
    return _rate_limiter
