"""Redis publisher for legacy and enriched AI-engine signal messages."""

from __future__ import annotations

from collections import deque
import asyncio
import json
from pathlib import Path
from typing import Any

try:
    from config import Settings
    from models.legacy_contract_models import LegacyPublishResult, LegacySignalMessage
    from models.intelligence_models import RedisRetryResponse
    from services.redis_retry_spool import RedisRetrySpool
except ImportError:  # pragma: no cover
    from ..config import Settings
    from ..models.legacy_contract_models import LegacyPublishResult, LegacySignalMessage
    from ..models.intelligence_models import RedisRetryResponse
    from .redis_retry_spool import RedisRetrySpool

try:  # Optional at import time so local tests can run without Redis installed.
    import redis.asyncio as redis_asyncio  # type: ignore
except Exception:  # pragma: no cover
    redis_asyncio = None


class RedisSignalPublisher:
    """Publishes compatibility messages while degrading safely if Redis is unavailable."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Any | None = None
        self.backup_queue: deque[dict[str, Any]] = deque(maxlen=max(1, settings.redis_backup_queue_size))
        spool_path = Path(settings.redis_retry_spool_path)
        if not spool_path.is_absolute():
            spool_path = Path(__file__).resolve().parents[1] / spool_path
        self.retry_spool = RedisRetrySpool(spool_path, max_entries=settings.redis_retry_max_entries)
        self._retry_lock = asyncio.Lock()

    def _queue_retry(self, channel: str, payload: dict[str, Any], error: str) -> bool:
        self.backup_queue.append({"channel": channel, "payload": payload, "error": error})
        self.retry_spool.append(channel=channel, payload=payload, error=error)
        return True

    async def retry_pending(self, *, limit: int = 100) -> RedisRetryResponse:
        async with self._retry_lock:
            result = RedisRetryResponse()
            for entry in self.retry_spool.load(limit=max(0, limit)):
                result.attempted += 1
                try:
                    await self._publish_json(entry["channel"], entry["payload"])
                except Exception as exc:
                    result.errors.append(str(exc))
                    self.retry_spool.record_attempt(entry["retry_id"], error=str(exc))
                else:
                    result.published += 1
                    self.retry_spool.record_attempt(entry["retry_id"])
            result.remaining = self.retry_spool.count()
            return result

    def _get_client(self) -> Any:
        if redis_asyncio is None:
            raise RuntimeError("redis package is not installed")
        if self._client is None:
            self._client = redis_asyncio.from_url(
                self.settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=self.settings.redis_socket_timeout_seconds,
                socket_timeout=self.settings.redis_socket_timeout_seconds,
            )
        return self._client

    async def _publish_json(self, channel: str, payload: dict[str, Any]) -> bool:
        client = self._get_client()
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
        await client.publish(channel, encoded)
        return True

    async def publish(
        self,
        *,
        legacy_signal: LegacySignalMessage,
        enriched_message: dict[str, Any] | None = None,
    ) -> LegacyPublishResult:
        legacy_payload = legacy_signal.model_dump(mode="json", exclude_none=True)
        legacy_published = False
        enriched_published = False
        errors: list[str] = []
        retry_queued = 0

        if self.settings.legacy_redis_publish_enabled:
            try:
                legacy_published = await self._publish_json(self.settings.redis_channel, legacy_payload)
            except Exception as exc:
                errors.append(f"legacy:{exc}")
                try:
                    retry_queued += self._queue_retry(self.settings.redis_channel, legacy_payload, str(exc))
                except OSError as spool_error:
                    errors.append(f"retry_spool:{spool_error}")

        if self.settings.redis_enriched_publish_enabled and enriched_message is not None:
            try:
                enriched_published = await self._publish_json(self.settings.redis_enriched_channel, enriched_message)
            except Exception as exc:
                errors.append(f"enriched:{exc}")
                try:
                    retry_queued += self._queue_retry(self.settings.redis_enriched_channel, enriched_message, str(exc))
                except OSError as spool_error:
                    errors.append(f"retry_spool:{spool_error}")

        return LegacyPublishResult(
            legacy_published=legacy_published,
            enriched_published=enriched_published,
            retry_queued=retry_queued,
            error="; ".join(errors) if errors else None,
        )


__all__ = ["RedisSignalPublisher"]
