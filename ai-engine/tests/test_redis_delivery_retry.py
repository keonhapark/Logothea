import asyncio

from config import Settings
from models.legacy_contract_models import LegacySignalMessage
from services.redis_signal_publisher import RedisSignalPublisher


def publisher(tmp_path):
    return RedisSignalPublisher(Settings(
        _env_file=None,
        redis_retry_spool_path=str(tmp_path / "retry.jsonl"),
        legacy_redis_publish_enabled=True,
        redis_enriched_publish_enabled=False,
    ))


def test_failed_publish_survives_publisher_restart_and_retries(tmp_path):
    first = publisher(tmp_path)

    async def fail(channel, payload):
        raise ConnectionError("offline")

    first._publish_json = fail
    outcome = asyncio.run(first.publish(legacy_signal=LegacySignalMessage(
        ticker="WMT", raw_score=0, rationale="test", text_chunk="test", timestamp=1,
    )))
    assert not outcome.legacy_published
    assert outcome.retry_queued == 1
    assert outcome.error == "legacy:offline"
    second = publisher(tmp_path)
    delivered = []

    async def succeed(channel, payload):
        delivered.append((channel, payload))
        return True

    second._publish_json = succeed
    retried = asyncio.run(second.retry_pending())
    assert (retried.attempted, retried.published, retried.remaining) == (1, 1, 0)
    assert delivered[0][1]["ticker"] == "WMT"


def test_retry_retains_failure_and_concurrent_append(tmp_path):
    instance = publisher(tmp_path)
    instance.retry_spool.append(channel="first", payload={"id": 1}, error="offline")

    async def fail_and_append(channel, payload):
        instance.retry_spool.append(channel="second", payload={"id": 2}, error="offline")
        raise ConnectionError("still offline")

    instance._publish_json = fail_and_append
    result = asyncio.run(instance.retry_pending(limit=1))
    assert (result.attempted, result.published, result.remaining) == (1, 0, 2)
    entries = instance.retry_spool.load()
    assert entries[0]["attempts"] == 1
    assert entries[0]["last_error"] == "still offline"
    assert entries[1]["channel"] == "second"


def test_retry_success_does_not_drop_concurrent_append(tmp_path):
    instance = publisher(tmp_path)
    instance.retry_spool.append(channel="first", payload={}, error="offline")

    async def succeed_and_append(channel, payload):
        instance.retry_spool.append(channel="second", payload={}, error="offline")
        return True

    instance._publish_json = succeed_and_append
    result = asyncio.run(instance.retry_pending(limit=1))
    assert (result.published, result.remaining) == (1, 1)
    assert instance.retry_spool.load()[0]["channel"] == "second"


def test_concurrent_retries_do_not_publish_same_entry_twice(tmp_path):
    instance = publisher(tmp_path)
    instance.retry_spool.append(channel="first", payload={}, error="offline")
    calls = []

    async def deliver(channel, payload):
        calls.append(channel)
        await asyncio.sleep(0)
        return True

    async def run():
        return await asyncio.gather(instance.retry_pending(), instance.retry_pending())

    instance._publish_json = deliver
    results = asyncio.run(run())
    assert calls == ["first"]
    assert sum(result.published for result in results) == 1
