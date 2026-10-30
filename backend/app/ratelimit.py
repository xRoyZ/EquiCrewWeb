"""Per-IP rate limit of contact submissions (in memory only).

Skeleton: the rate-limit ticket fills ``RateLimiter``. Until then every request is
allowed and no IP is kept.
"""

from __future__ import annotations

import time
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
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.clock = clock

    def allow(self, key: str) -> bool:
        """Record one request of ``key``; True when it is within the limit."""
        return True

    def hit(self, key: str) -> bool:
        """Same as ``allow`` (the name the sprint's shared interface uses)."""
        return self.allow(key)

    def tracked_ips(self) -> int:
        """How many keys are currently held in memory."""
        return 0


_rate_limiter = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    """The process-wide rate limiter shared by every request."""
    return _rate_limiter
