"""Tests of the per-IP sliding-window rate limit and its effect on POST /api/contact."""

from __future__ import annotations

import threading
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.ratelimit import MAX_REQUESTS, WINDOW_SECONDS, RateLimiter, get_rate_limiter

VALID_FORM = {
    "first_name": "Erika",
    "last_name": "Muster",
    "email": "erika@example.com",
    "message": "Hallo EquiCrew!",
    "website": "",
}


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def limiter(clock: FakeClock) -> RateLimiter:
    return RateLimiter(clock=clock)


@pytest.fixture(autouse=True)
def reset_singleton() -> Iterator[None]:
    get_rate_limiter().reset()
    yield
    get_rate_limiter().reset()


def test_defaults_are_five_per_ten_minutes() -> None:
    assert MAX_REQUESTS == 5
    assert WINDOW_SECONDS == 600


def test_five_allowed_sixth_denied(limiter: RateLimiter, clock: FakeClock) -> None:
    for _ in range(5):
        assert limiter.allow("203.0.113.1") is True
        clock.advance(1)
    assert limiter.allow("203.0.113.1") is False


def test_ips_are_counted_separately(limiter: RateLimiter) -> None:
    for _ in range(5):
        assert limiter.allow("203.0.113.1")
    assert not limiter.allow("203.0.113.1")
    assert limiter.allow("203.0.113.2")


def test_allowed_again_after_the_window(limiter: RateLimiter, clock: FakeClock) -> None:
    for _ in range(6):
        limiter.allow("203.0.113.1")
    assert not limiter.allow("203.0.113.1")
    clock.advance(WINDOW_SECONDS + 1)
    assert limiter.allow("203.0.113.1") is True


def test_window_slides(limiter: RateLimiter, clock: FakeClock) -> None:
    assert limiter.allow("ip")
    clock.advance(300)
    for _ in range(4):
        assert limiter.allow("ip")
    clock.advance(301)  # the first request has left the window, the other four not
    assert limiter.allow("ip") is True
    assert limiter.allow("ip") is False


def test_ip_evicted_after_ten_minutes_of_silence(limiter: RateLimiter, clock: FakeClock) -> None:
    limiter.allow("203.0.113.1")
    clock.advance(60)
    limiter.allow("198.51.100.7")
    assert limiter.tracked_ips() == 2
    clock.advance(WINDOW_SECONDS - 60 + 1)  # 10 min after the first IP's last request
    assert limiter.tracked_ips() == 1
    clock.advance(60)
    assert limiter.tracked_ips() == 0


def test_stale_ips_are_purged_on_allow(limiter: RateLimiter, clock: FakeClock) -> None:
    limiter.allow("203.0.113.1")
    clock.advance(WINDOW_SECONDS + 1)
    limiter.allow("198.51.100.7")
    assert "203.0.113.1" not in limiter._requests
    assert limiter.tracked_ips() == 1


def test_thread_safe_counting(clock: FakeClock) -> None:
    limiter = RateLimiter(max_requests=50, clock=clock)
    results: list[bool] = []
    lock = threading.Lock()

    def worker() -> None:
        for _ in range(20):
            allowed = limiter.allow("ip")
            with lock:
                results.append(allowed)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results.count(True) == 50


def test_get_rate_limiter_is_a_singleton() -> None:
    assert get_rate_limiter() is get_rate_limiter()
    assert isinstance(get_rate_limiter(), RateLimiter)


def test_sixth_contact_post_answers_429(client: TestClient) -> None:
    for _ in range(5):
        response = client.post("/api/contact", json=VALID_FORM)
        assert response.status_code != 429
    response = client.post("/api/contact", json=VALID_FORM)
    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "rate_limited"
    assert "zu viele anfragen" in error["message"].lower()
