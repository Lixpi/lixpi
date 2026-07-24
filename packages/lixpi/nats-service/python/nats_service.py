"""
NATS Service Client for Python
Shared implementation mirroring TypeScript version with optional self-issued JWT authentication.
"""

import asyncio
import io
import json
import time
import base64
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union
from enum import Enum

import nats
from nats.aio.client import Client as NATS
from nats.aio.msg import Msg
from nats.js import JetStreamContext
from nats.js.api import ConsumerConfig, ObjectStoreConfig, ObjectInfo, ObjectMeta
from nats.js.object_store import ObjectStore
from nkeys import from_seed
from colorama import Fore, Style
from lixpi_debug_tools import log, info, info_str, warn, err


DEFAULT_STREAM_REPLICAS = 3


def encode(value: Any, payload_type: str) -> bytes:
    """Encode value based on payload type."""
    if payload_type == 'json':
        return json.dumps(value).encode()

    if payload_type == 'buffer':
        if isinstance(value, str):
            return value.encode()
        return value


def decode(msg: 'Msg', payload_type: str) -> Any:
    """Decode message based on payload type."""
    if payload_type == 'json':
        return json.loads(msg.data.decode())

    if payload_type == 'buffer':
        return msg.data.decode()


def generate_self_issued_jwt(nkey_seed: str, user_id: str, expiry_hours: int = 1) -> str:
    """
    Generate a self-issued JWT signed with NKey (Ed25519).

    This is optional and only used by services that require self-issued JWT authentication.

    Args:
        nkey_seed: Base32-encoded NKey seed (starts with 'SU')
        user_id: Service identity (e.g., 'svc:llm-service')
        expiry_hours: Token validity period in hours (default: 1)

    Returns:
        Signed JWT token string
    """
    # Create NKey pair from seed
    kp = from_seed(nkey_seed.encode())

    # Get public key for issuer field
    public_key = kp.public_key.decode()

    # Create JWT claims
    now = int(time.time())
    claims = {
        "sub": user_id,           # Subject: service identity
        "iss": public_key,        # Issuer: our public key
        "iat": now,               # Issued at
        "exp": now + (expiry_hours * 3600)  # Expiry
    }

    # Create JWT header
    header = {
        "typ": "JWT",
        "alg": "EdDSA"  # Ed25519 signature algorithm
    }

    # Encode header and claims as base64url
    def base64url_encode(data: dict) -> str:
        json_str = json.dumps(data, separators=(',', ':'))
        encoded = base64.urlsafe_b64encode(json_str.encode()).rstrip(b'=')
        return encoded.decode()

    header_b64 = base64url_encode(header)
    claims_b64 = base64url_encode(claims)

    # Create signing input
    message = f"{header_b64}.{claims_b64}"

    # Sign with NKey
    signature = kp.sign(message.encode())
    signature_b64 = base64.urlsafe_b64encode(signature).rstrip(b'=').decode()

    # Construct final JWT
    jwt_token = f"{message}.{signature_b64}"

    log(f"Generated self-issued JWT for {user_id}, expires in {expiry_hours}h")

    return jwt_token


class PayloadType(str, Enum):
    """Payload encoding types."""
    JSON = "json"
    BUFFER = "buffer"


class SubscriptionType(str, Enum):
    """Subscription types."""
    SUBSCRIBE = "subscribe"
    REPLY = "reply"


class NatsServiceConfig:
    """Configuration for NATS service."""

    def __init__(
        self,
        servers: Optional[List[str]] = None,
        name: Optional[str] = None,
        token: Optional[str] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
        nkey_seed: Optional[str] = None,
        user_id: Optional[str] = None,
        tls_ca_cert: Optional[str] = None,
        max_reconnect_attempts: int = -1,
        reconnect_time_wait: float = 0.5,
        subscriptions: Optional[List[Dict[str, Any]]] = None,
        middleware: Optional[List[Callable]] = None,
        reply_middleware: Optional[List[Callable]] = None,
        get_token: Optional[Callable[[], Any]] = None,
        on_auth_error: Optional[Callable[[Exception], Any]] = None,
        stream_replicas: int = DEFAULT_STREAM_REPLICAS,
    ):
        """
        Initialize NATS service configuration.

        Args:
            servers: List of NATS server URLs
            name: Client name
            token: Auth token (can be regular token or JWT)
            user: Username for basic auth
            password: Password for basic auth
            nkey_seed: NKey seed for self-issued JWT (optional)
            user_id: User ID for JWT subject when using nkey_seed (optional)
            tls_ca_cert: Path to TLS CA certificate (optional)
            max_reconnect_attempts: Maximum reconnection attempts (-1 for infinite)
            reconnect_time_wait: Wait time between reconnections in seconds
            get_token: Optional (async) callable used to (re)fetch a fresh auth
                token before every connect/reconnect attempt. When supplied it
                takes precedence over the static `token` and lets the connection
                recover from token expiry or signing-key rotation without a
                manual restart.
            on_auth_error: Optional callable invoked when the server rejects our
                credentials so the caller can invalidate any cached token before
                `get_token` is called again.
            stream_replicas: Replication factor for created JetStream stores.
        """
        self.servers = servers or ["nats://localhost:4222"]
        self.name = name or "default"
        self.token = token
        self.user = user
        self.password = password
        self.nkey_seed = nkey_seed
        self.user_id = user_id
        self.tls_ca_cert = tls_ca_cert
        self.max_reconnect_attempts = max_reconnect_attempts
        self.reconnect_time_wait = reconnect_time_wait
        self.subscriptions = subscriptions or []
        self.middleware = middleware or []
        self.reply_middleware = reply_middleware or []
        self.get_token = get_token
        self.on_auth_error = on_auth_error
        self.stream_replicas = stream_replicas


class NatsService:
    """
    NATS Service client mirroring TypeScript implementation.
    Supports optional self-issued JWT authentication via NKeys.
    """

    _instance: Optional['NatsService'] = None

    def __init__(self, config: NatsServiceConfig):
        """
        Initialize NATS service.

        Args:
            config: NATS service configuration
        """
        self.config = config
        self.nc: Optional[NATS] = None
        self.js: Optional[JetStreamContext] = None
        self._objm = None  # Object Store manager cache
        self._subscriptions: Dict[str, Any] = {}
        self._is_connecting = False
        self._is_monitoring = False
        self._reconnect_timer: Optional[asyncio.Task] = None
        self._subscriptions_initialized = False
        self._reconnect_attempts = 0
        # Latest token handed to the connection. Kept in sync so a reconnect after
        # a token expiry or signing-key rotation presents fresh credentials rather
        # than the token captured once at connect time.
        self._current_token: Optional[str] = None
        # Set during graceful disconnect()/drain() so the close callback does not
        # try to reconnect after an intentional close.
        self._intentional_close = False

    @classmethod
    def get_instance(cls) -> Optional['NatsService']:
        """Get singleton instance."""
        return cls._instance

    @classmethod
    async def init(cls, config: NatsServiceConfig) -> 'NatsService':
        """
        Initialize singleton instance and connect.

        Args:
            config: NATS service configuration

        Returns:
            NatsService instance
        """
        if not cls._instance:
            cls._instance = cls(config)
            await cls._instance.connect()
        return cls._instance

    def _schedule_reconnect(self, delay: Optional[float] = None) -> None:
        """
        Schedule reconnection attempt with exponential backoff.

        Args:
            delay: Delay in seconds before reconnection attempt (defaults to exponential backoff)
        """
        if self._reconnect_timer:
            self._reconnect_timer.cancel()

        # Exponential backoff: 0.5s, 1s, 2s, 4s, 8s, max 16s
        if delay is None:
            delay = min(0.5 * (2 ** self._reconnect_attempts), 16.0)
            self._reconnect_attempts += 1

        async def reconnect_task():
            await asyncio.sleep(delay)
            await self.connect()

        self._reconnect_timer = asyncio.create_task(reconnect_task())

    def _monitor_status(self) -> None:
        """Monitor NATS connection status changes."""
        if not self.nc or self._is_monitoring:
            return
        self._is_monitoring = True

        async def monitor_loop():
            """Status monitoring loop - not supported in Python NATS client."""
            # Python NATS client doesn't expose status iterator like TypeScript
            # Status changes are handled via callbacks (error_cb, disconnected_cb, etc.)
            pass

        asyncio.create_task(monitor_loop())

    async def _init_subscriptions(self) -> None:
        """Initialize subscriptions from config."""
        if not self.nc or self._subscriptions_initialized:
            return

        subs = self.config.subscriptions or []
        if len(subs) == 0:
            self._subscriptions_initialized = True
            return

        for listener in subs:
            try:
                subscription_type = listener.get('type', 'subscribe')
                subject = listener['subject']
                handler = listener['handler']
                queue = listener.get('queue')
                payload_type = listener.get('payloadType', 'json')

                subscription_options = {'queue': queue} if queue else {}

                if subscription_type == 'reply':
                    subscription = await self.reply(
                        subject,
                        handler,
                        subscription_options,
                        payload_type
                    )
                else:
                    subscription = await self.subscribe(
                        subject,
                        handler,
                        subscription_options,
                        payload_type
                    )

                if subscription:
                    info_str([Fore.GREEN, "NATS -> ", Style.RESET_ALL, Fore.WHITE, "register:", Fore.CYAN, subscription_type.ljust(10, ' '), Style.RESET_ALL, Fore.WHITE, ": ", Style.RESET_ALL, Fore.GREEN, subject, Style.RESET_ALL, Fore.WHITE, f" with queue: {queue}" if queue else "", Style.RESET_ALL])

            except Exception as e:
                err(f"Failed to subscribe to NATS subject {listener.get('subject')}: {e}")

        self._subscriptions_initialized = True

    async def _apply_middleware(
        self,
        data: Any,
        msg: Msg,
        handlers: List[Callable]
    ) -> Dict[str, Any]:
        """Apply middleware chain to message."""
        current_data = {"data": data, "msg": msg}
        for middleware_func in handlers:
            result = middleware_func(current_data["data"], current_data["msg"])
            if asyncio.iscoroutine(result):
                result = await result
            current_data = result
        return current_data

    def _build_connection_options(self) -> Dict[str, Any]:
        """Build NATS connection options."""
        options = {
            "servers": self.config.servers,
            "name": self.config.name,
            "max_reconnect_attempts": self.config.max_reconnect_attempts,
            "reconnect_time_wait": self.config.reconnect_time_wait,
            "error_cb": self._error_callback,
            "disconnected_cb": self._disconnected_callback,
            "reconnected_cb": self._reconnected_callback,
            "closed_cb": self._closed_callback,
        }

        self._apply_authentication(options)
        return options

    def _apply_authentication(self, options: Dict[str, Any]) -> None:
        """Apply authentication to connection options."""
        if self.config.nkey_seed and self.config.user_id:
            # Priority 1: Self-issued JWT using NKey seed (Ed25519 signing)
            # Used by services that need cryptographically signed authentication.
            # _refresh_token() regenerates a fresh (non-expired) JWT before each
            # connect attempt; fall back to generating one here if it wasn't set.
            if not self._current_token:
                self._current_token = generate_self_issued_jwt(
                    nkey_seed=self.config.nkey_seed,
                    user_id=self.config.user_id,
                    expiry_hours=1
                )
            info(f"Using self-issued JWT for user: {self.config.user_id}")
            options["token"] = self._current_token
        elif self.config.get_token or self.config.token or self._current_token:
            # Priority 2: Pre-generated / provider-supplied JWT token.
            # Uses the freshest token captured by _refresh_token() so a reconnect
            # never replays a token that has since expired or been rotated out.
            if not self._current_token and self.config.token:
                self._current_token = self.config.token
            options["token"] = self._current_token
        elif self.config.user and self.config.password:
            # Priority 3: Basic username/password authentication
            # Legacy auth method, less secure than JWT
            options["user"] = self.config.user
            options["password"] = self.config.password
        # If none provided, connection will be attempted without authentication

    async def _refresh_token(self) -> None:
        """Refresh the token used for authentication before a connect attempt.

        Prefers the async provider, then regenerates the self-issued JWT (which
        expires hourly), then falls back to the static token.
        """
        if self.config.get_token:
            try:
                fresh = self.config.get_token()
                if asyncio.iscoroutine(fresh):
                    fresh = await fresh
                if fresh:
                    self._current_token = fresh
            except Exception as error:
                err(f"NATS -> failed to refresh auth token: {error}")
        elif self.config.nkey_seed and self.config.user_id:
            self._current_token = generate_self_issued_jwt(
                nkey_seed=self.config.nkey_seed,
                user_id=self.config.user_id,
                expiry_hours=1
            )
        elif self.config.token:
            self._current_token = self.config.token

    async def _handle_auth_error(self, error: Exception) -> None:
        """Notify the caller that the server rejected our credentials so it can
        clear any cached token before the next _refresh_token() call."""
        if not self.config.on_auth_error:
            return
        try:
            result = self.config.on_auth_error(error)
            if asyncio.iscoroutine(result):
                await result
        except Exception as cb_error:
            err(f"NATS -> on_auth_error handler failed: {cb_error}")

    @staticmethod
    def _is_auth_error(error: Any) -> bool:
        """Detect authorization/authentication failures across error shapes."""
        name = type(error).__name__ if isinstance(error, BaseException) else ''
        message = str(error) if error is not None else ''
        return 'Authorization' in name or 'authoriz' in message.lower() or 'authentic' in message.lower()

    async def connect(self, initial_connect_timeout: int = 2) -> None:
        """
        Connect to NATS server. Does not crash on failure, schedules reconnection.

        Args:
            initial_connect_timeout: Timeout for initial connection in seconds
        """
        if self._is_connecting or self.is_connected():
            return

        self._is_connecting = True
        self._intentional_close = False

        try:
            # Fetch a fresh token before every attempt so a reconnect after a token
            # expiry or signing-key rotation does not keep replaying stale creds.
            await self._refresh_token()

            options = self._build_connection_options()

            # Handle TLS if CA cert provided
            if self.config.tls_ca_cert:
                import ssl
                tls_ctx = ssl.create_default_context(purpose=ssl.Purpose.SERVER_AUTH)
                tls_ctx.load_verify_locations(cafile=self.config.tls_ca_cert)
                options["tls"] = tls_ctx
                info("TLS context configured with custom CA cert")

            # Connect to NATS with timeout
            self.nc = await asyncio.wait_for(
                nats.connect(**options),
                timeout=initial_connect_timeout
            )

            info_str([Fore.GREEN, "NATS -> listening on: ", Style.RESET_ALL, Fore.BLUE, f"nats://{self.nc.connected_url.netloc}", Style.RESET_ALL])

            # Reset reconnect attempts on successful connection
            self._reconnect_attempts = 0

            # Initialize JetStream context
            self.js = self.nc.jetstream()

            # Monitor status changes
            self._monitor_status()

            # Initialize subscriptions from config
            await self._init_subscriptions()

        except asyncio.TimeoutError:
            err("NATS -> connection error or timeout")
            self._schedule_reconnect()
        except Exception as error:
            if self._is_auth_error(error):
                # Server rejected our credentials. Let the caller invalidate its
                # cached token so the next _refresh_token() obtains a valid one
                # instead of looping forever on the same rejected token.
                err(f"NATS -> authorization failed, refreshing credentials: {error}")
                await self._handle_auth_error(error)
            else:
                err(f"NATS -> connection error or timeout: {error}")
            self._schedule_reconnect()
        finally:
            self._is_connecting = False

    async def disconnect(self) -> None:
        """Disconnect from NATS server."""
        if self.nc and not self.nc.is_closed:
            self._intentional_close = True
            if self._reconnect_timer:
                self._reconnect_timer.cancel()
            await self.nc.close()
            info("NATS disconnected gracefully.")

    async def drain(self) -> None:
        """Drain all subscriptions and disconnect."""
        if self.nc and not self.nc.is_closed:
            self._intentional_close = True
            if self._reconnect_timer:
                self._reconnect_timer.cancel()
            await self.nc.drain()
            info("NATS drained all subscriptions and disconnected.")

    def is_connected(self) -> bool:
        """Check if connected to NATS."""
        return self.nc is not None and not self.nc.is_closed

    def get_connection(self) -> Optional[NATS]:
        """Get underlying NATS connection."""
        return self.nc

    def publish(self, subject: str, data: Any) -> None:
        """
        Publish JSON data to a subject.

        Args:
            subject: NATS subject to publish to
            data: Data to publish (will be JSON encoded)
        """
        if not self.nc:
            err("NATS client is not connected.")
            return

        # Python NATS requires async, schedule as task
        asyncio.create_task(self.nc.publish(subject, encode(data, 'json')))

    async def subscribe(
        self,
        subject: str,
        handler: Callable[[Any, Msg], None],
        options: Optional[Dict[str, str]] = None,
        payload_type: str = 'json'
    ) -> Optional[Any]:
        """
        Subscribe to a NATS subject.

        Args:
            subject: NATS subject to subscribe to
            handler: Callback function to handle messages
            options: Subscription options (queue)
            payload_type: Payload encoding type ('json' or 'buffer')

        Returns:
            Subscription object or None
        """
        if not self.nc:
            err("NATS client is not connected.")
            return None

        options = options or {}
        queue = options.get('queue')

        # Apply middleware
        middleware_chain = self.config.reply_middleware or self.config.middleware or []

        async def message_handler(msg: Msg):
            """Wrapper to handle message decoding and error handling."""
            try:
                # Decode payload
                data = decode(msg, payload_type)

                # Apply middleware if configured
                if middleware_chain:
                    result = await self._apply_middleware(data, msg, middleware_chain)
                    data = result["data"]

                # Call handler
                await handler(data, msg)

            except Exception as error:
                err(f"Error processing message on subject {subject}", {
                    "error": error,
                    "messageData": msg.data.decode() if msg.data else "no data",
                    "subject": msg.subject,
                    "payloadType": payload_type
                })

        # Subscribe with or without queue group
        if queue:
            subscription = await self.nc.subscribe(subject, queue=queue, cb=message_handler)
        else:
            subscription = await self.nc.subscribe(subject, cb=message_handler)

        # Track subscription for unsubscribe_all
        self._subscriptions[subject] = subscription

        return subscription

    async def request(
        self,
        subject: str,
        data: Any,
        timeout: float = 3.0
    ) -> Any:
        """
        Send a request and wait for reply.

        Args:
            subject: NATS subject to send request to
            data: Data to send
            timeout: Timeout in seconds (default: 3.0)

        Returns:
            Reply data
        """
        if not self.nc:
            err("NATS client is not connected.")
            return None

        response = await self.nc.request(subject, encode(data, 'json'), timeout=timeout)
        return json.loads(response.data.decode())

    async def reply(
        self,
        subject: str,
        handler: Callable[[Any, Msg], Any],
        options: Optional[Dict[str, str]] = None,
        payload_type: str = 'json'
    ) -> Optional[Any]:
        """
        Subscribe to a subject and reply to requests.

        Args:
            subject: NATS subject to subscribe to
            handler: Callback function that returns reply data
            options: Subscription options (queue)
            payload_type: Payload encoding type ('json' or 'buffer')

        Returns:
            Subscription object or None
        """
        if not self.nc:
            err("NATS client is not connected.")
            return None

        options = options or {}
        queue = options.get('queue')

        # Apply middleware
        middleware_chain = self.config.reply_middleware or self.config.middleware or []

        async def reply_handler(msg: Msg):
            """Wrapper to handle request/reply pattern."""
            try:
                # Decode request payload
                data = decode(msg, payload_type)

                # Apply middleware if configured
                if middleware_chain:
                    result = await self._apply_middleware(data, msg, middleware_chain)
                    data = result["data"]

                # Call handler to get reply
                result = await handler(data, msg)

                # Encode and send reply
                await msg.respond(encode(result, payload_type))

            except Exception as error:
                err(f"Reply error on subject {subject}", error)
                # Send error reply
                await msg.respond(encode(error, payload_type))

        # Subscribe with or without queue group
        if queue:
            subscription = await self.nc.subscribe(subject, queue=queue, cb=reply_handler)
        else:
            subscription = await self.nc.subscribe(subject, cb=reply_handler)

        # Track subscription for unsubscribe_all
        self._subscriptions[subject] = subscription

        return subscription

    async def unsubscribe_all(self) -> None:
        """Unsubscribe from all subscriptions."""
        if not self.nc or self.nc.is_closed:
            return

        for sub_name, sub in list(self._subscriptions.items()):
            try:
                await sub.unsubscribe()
            except Exception as e:
                err(f"Error unsubscribing from {sub_name}: {e}")

        self._subscriptions.clear()
        log("All NATS subscriptions cancelled via built-in tracking.")

    def get_subscriptions(self, subject_or_subjects: Optional[Any] = None) -> Dict[str, Any]:
        """Get subscriptions filtered by subject pattern."""
        def match_filter(value: str, filter_pattern: str) -> bool:
            idx = filter_pattern.find('*')
            if idx < 0:
                return value == filter_pattern
            if filter_pattern.find('*', idx + 1) != -1:
                return False  # multiple '*' => fallback
            prefix = filter_pattern[:idx]
            suffix = filter_pattern[idx + 1:]
            return value.startswith(prefix) and value.endswith(suffix)

        if subject_or_subjects is None:
            subject_or_subjects = []

        subjects = subject_or_subjects if isinstance(subject_or_subjects, list) else [subject_or_subjects]
        result = {}

        if not self.nc or self.nc.is_closed:
            return result

        for sub_subject, sub in self._subscriptions.items():
            if not subjects or any(match_filter(sub_subject, f) for f in subjects):
                result[sub_subject] = sub

        return result

    # Connection event callbacks

    async def _error_callback(self, e: Exception) -> None:
        """Handle NATS errors."""
        err(f"NATS -> connection error: {e}")
        # If the server rejected our credentials (expired token or rotated signing
        # key), refresh them so the next reconnect presents valid credentials.
        if self._is_auth_error(e):
            await self._handle_auth_error(e)
            await self._refresh_token()

    async def _disconnected_callback(self) -> None:
        """Handle NATS disconnection."""
        err("NATS -> disconnected")

    async def _reconnected_callback(self) -> None:
        """Handle NATS reconnection."""
        info("NATS -> reconnected")
        # Check if subscriptions need to be initialized after reconnect
        if not self._subscriptions_initialized:
            await self._init_subscriptions()

    async def _closed_callback(self) -> None:
        """Handle NATS connection closure."""
        warn("NATS -> connection closed")
        # Reset the initialized flag on close so we can reconnect properly
        self._subscriptions_initialized = False
        # Reconnect unless we intentionally closed the connection.
        if not self._intentional_close:
            self._schedule_reconnect()

    # ===========================================
    # JetStream Object Store Methods
    # ===========================================

    def _get_jetstream(self) -> JetStreamContext:
        """Get JetStream context."""
        if not self.nc:
            raise RuntimeError("NATS client is not connected.")
        if not self.js:
            self.js = self.nc.jetstream()
        return self.js

    def _get_object_store_manager(self):
        """Get Object Store manager."""
        if not self._objm:
            self._objm = self._get_jetstream()
        return self._objm

    @staticmethod
    def _is_stream_not_found_error(error: Any) -> bool:
        """Return whether a JetStream error means the stream is absent."""
        message = str(error or '').lower()
        code = getattr(error, 'code', None)
        error_code = getattr(error, 'err_code', None)
        if 'no responders' in message or 'timeout' in message or '503' in message:
            return False
        return (
            code == 404
            or error_code == 10059
            or 'stream not found' in message
            or 'no stream' in message
            or 'not found' in message
        )

    async def _open_object_store_or_none(
        self,
        bucket_name: str
    ) -> Optional[ObjectStore]:
        """Open an Object Store, returning None only when it is absent."""
        try:
            return await self.get_object_store(bucket_name)
        except Exception as error:
            if self._is_stream_not_found_error(error):
                return None
            raise

    async def create_object_store(
        self,
        bucket_name: str,
        options: Optional[ObjectStoreConfig] = None
    ) -> ObjectStore:
        """Create an Object Store bucket."""
        js = self._get_jetstream()
        if options:
            replicas = (
                options.replicas
                if options.replicas is not None
                else self.config.stream_replicas
            )
            os = await js.create_object_store(
                bucket_name,
                config=ObjectStoreConfig(**{
                    **options.as_dict(),
                    'replicas': replicas,
                })
            )
        else:
            replicas = self.config.stream_replicas
            os = await js.create_object_store(
                bucket_name,
                config=ObjectStoreConfig(replicas=replicas)
            )
        info(f"Object Store bucket created: {bucket_name} (replicas={replicas})")
        return os

    async def get_object_store(self, bucket_name: str) -> ObjectStore:
        """Open an existing Object Store bucket."""
        js = self._get_jetstream()
        return await js.object_store(bucket_name)

    async def delete_object_store(self, bucket_name: str) -> bool:
        """Delete an Object Store bucket."""
        js = self._get_jetstream()
        result = await js.delete_object_store(bucket_name)
        info(f"Object Store bucket deleted: {bucket_name}")
        return result

    async def list_stream_names(self) -> List[str]:
        """List all stream names visible to the current NATS account."""
        stream_names = []
        async for stream_info in self._get_jetstream().streams_info_iterator():
            stream_names.append(stream_info.config.name)
        return stream_names

    async def ensure_stream_replicas(
        self,
        stream_name: str,
        replicas: Optional[int] = None
    ) -> Dict[str, Any]:
        """Scale a stream up to the requested replication factor."""
        js = self._get_jetstream()
        target = (
            replicas
            if replicas is not None
            else self.config.stream_replicas
        )
        stream_info = await js.stream_info(stream_name)
        current = stream_info.config.num_replicas or 1
        if current >= target:
            return {
                'name': stream_name,
                'from': current,
                'to': current,
                'changed': False,
            }
        config = stream_info.config.as_dict()
        config['num_replicas'] = target
        await js.update_stream(**config)
        return {
            'name': stream_name,
            'from': current,
            'to': target,
            'changed': True,
        }

    async def ensure_jetstream_stream(self, config: Dict[str, Any]) -> Any:
        """Create or update a stream while preserving existing subjects."""
        js = self._get_jetstream()
        try:
            stream_info = await js.stream_info(config['name'])
            existing_config = stream_info.config.as_dict()
            existing_subjects = existing_config.get('subjects') or []
            requested_subjects = config.get('subjects') or []
            next_subjects = list(dict.fromkeys(existing_subjects + requested_subjects))
            requested_config = {**config, 'subjects': next_subjects}
            is_current = all(
                existing_config.get(key) == value
                for key, value in requested_config.items()
            )
            if is_current:
                return stream_info
            return await js.update_stream(**{
                **existing_config,
                **requested_config,
            })
        except Exception as error:
            if not self._is_stream_not_found_error(error):
                raise
            return await js.add_stream(**config)

    async def get_jetstream_stream_info(
        self,
        stream_name: str,
        options: Optional[Dict[str, Any]] = None
    ) -> Any:
        """Read metadata for a JetStream stream."""
        options = options or {}
        return await self._get_jetstream().stream_info(stream_name, **options)

    async def get_jetstream_stream_info_or_none(
        self,
        stream_name: str,
        options: Optional[Dict[str, Any]] = None
    ) -> Optional[Any]:
        """Read stream metadata, returning None only when it is absent."""
        try:
            return await self.get_jetstream_stream_info(stream_name, options)
        except Exception as error:
            if self._is_stream_not_found_error(error):
                return None
            raise

    async def get_jetstream_message(
        self,
        stream_name: str,
        request: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Read and decode one JetStream message."""
        js = self._get_jetstream()
        try:
            if 'last_by_subj' in request:
                message = await js.get_last_msg(
                    stream_name,
                    request['last_by_subj'],
                    direct=request.get('direct', False)
                )
            else:
                subject = request.get('next_by_subj')
                message = await js.get_msg(
                    stream_name,
                    seq=request.get('seq'),
                    subject=subject,
                    direct=request.get('direct', False),
                    next=subject is not None
                )
            if not message:
                return None
            return {
                'data': json.loads(message.data.decode()),
                'subject': message.subject,
                'seq': message.sequence,
            }
        except Exception as error:
            if self._is_stream_not_found_error(error):
                return None
            raise

    async def publish_jetstream(
        self,
        subject: str,
        data: Any,
        options: Optional[Dict[str, Any]] = None
    ) -> Any:
        """Publish JSON or bytes to JetStream with optional expectations."""
        options = options or {}
        payload = (
            bytes(data)
            if isinstance(data, (bytes, bytearray, memoryview))
            else json.dumps(data).encode()
        )
        headers = dict(options.get('headers') or {})
        message_id = options.get('msg_id', options.get('msgID'))
        if message_id is not None:
            headers['Nats-Msg-Id'] = str(message_id)
        expectations = options.get('expect') or {}
        expectation_headers = {
            'stream_name': 'Nats-Expected-Stream',
            'streamName': 'Nats-Expected-Stream',
            'last_sequence': 'Nats-Expected-Last-Sequence',
            'lastSequence': 'Nats-Expected-Last-Sequence',
            'last_msg_id': 'Nats-Expected-Last-Msg-Id',
            'lastMsgID': 'Nats-Expected-Last-Msg-Id',
            'last_subject_sequence': 'Nats-Expected-Last-Subject-Sequence',
            'lastSubjectSequence': 'Nats-Expected-Last-Subject-Sequence',
        }
        for key, value in expectations.items():
            header_name = expectation_headers.get(key)
            if header_name is None:
                raise ValueError(f"Unsupported JetStream expectation: {key}")
            headers[header_name] = str(value)
        return await self._get_jetstream().publish(
            subject,
            payload,
            headers=headers or None
        )

    async def ensure_jetstream_consumer(
        self,
        stream_name: str,
        config: Dict[str, Any]
    ) -> Any:
        """Create or update a durable JetStream consumer."""
        js = self._get_jetstream()
        durable_name = config['durable_name']
        try:
            consumer_info = await js.consumer_info(stream_name, durable_name)
            existing_config = consumer_info.config.as_dict()
            return await js.add_consumer(
                stream_name,
                config=ConsumerConfig(**{**existing_config, **config})
            )
        except Exception as error:
            if not self._is_stream_not_found_error(error):
                raise
            return await js.add_consumer(
                stream_name,
                config=ConsumerConfig(**config)
            )

    async def consume_jetstream_messages(
        self,
        stream_name: str,
        consumer_name: str,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Fetch, decode, and acknowledge messages from a durable consumer."""
        options = options or {}
        subscription = await self._get_jetstream().pull_subscribe_bind(
            stream=stream_name,
            consumer=consumer_name
        )
        try:
            messages = await subscription.fetch(
                batch=options.get('max_messages', 100),
                timeout=options.get('expires_ms', 1000) / 1000
            )
        except nats.errors.TimeoutError:
            return []
        decoded_messages = []
        for message in messages:
            decoded_messages.append(self._decode_jetstream_message(message))
            await message.ack()
        return decoded_messages

    async def process_jetstream_messages(
        self,
        stream_name: str,
        consumer_name: str,
        handler: Callable[[Dict[str, Any]], Awaitable[Optional[Dict[str, int]]]],
        options: Optional[Dict[str, Any]] = None
    ) -> int:
        """Process messages and apply explicit ack/nak dispositions."""
        options = options or {}
        subscription = await self._get_jetstream().pull_subscribe_bind(
            stream=stream_name,
            consumer=consumer_name
        )
        try:
            messages = await subscription.fetch(
                batch=options.get('max_messages', 100),
                timeout=options.get('expires_ms', 1000) / 1000
            )
        except nats.errors.TimeoutError:
            return 0
        processed = 0
        for message in messages:
            try:
                disposition = await handler(self._decode_jetstream_message(message))
                if disposition:
                    delay_ms = disposition.get(
                        'nak_delay_ms',
                        disposition.get('nakDelayMs')
                    )
                    await message.nak(
                        delay=None if delay_ms is None else delay_ms / 1000
                    )
                    continue
                await message.ack()
                processed += 1
            except Exception:
                delay_ms = options.get(
                    'nak_delay_ms',
                    options.get('nakDelayMs')
                )
                await message.nak(
                    delay=None if delay_ms is None else delay_ms / 1000
                )
                raise
        return processed

    @staticmethod
    def _decode_jetstream_message(message: Msg) -> Dict[str, Any]:
        """Decode a JetStream message into the shared service shape."""
        return {
            'data': json.loads(message.data.decode()),
            'subject': message.subject,
            'seq': message.metadata.sequence.stream,
        }

    async def purge_jetstream_subject(
        self,
        stream_name: str,
        subject: str,
        options: Optional[Dict[str, Any]] = None
    ) -> None:
        """Purge a filtered subject, optionally through an inclusive sequence."""
        options = options or {}
        through_sequence = options.get(
            'through_sequence',
            options.get('throughSequence')
        )
        await self._get_jetstream().purge_stream(
            stream_name,
            subject=subject,
            seq=None if through_sequence is None else through_sequence + 1
        )

    async def put_object(
        self,
        bucket_name: str,
        name: str,
        data: bytes,
        meta: Optional[ObjectMeta] = None
    ) -> ObjectInfo:
        """Store data as an object."""
        os = await self.get_object_store(bucket_name)
        result = await os.put(name, data, meta=meta)
        info(f"Object stored: {bucket_name}/{name} ({len(data)} bytes)")
        return result

    async def put_object_from_readable(
        self,
        bucket_name: str,
        name: str,
        readable: io.BufferedIOBase,
        meta: Optional[ObjectMeta] = None
    ) -> ObjectInfo:
        """Store data from a readable stream."""
        os = await self.get_object_store(bucket_name)
        result = await os.put(name, readable, meta=meta)
        info(f"Object stored from stream: {bucket_name}/{name}")
        return result

    async def get_object(self, bucket_name: str, name: str) -> Optional[bytes]:
        """Retrieve an object as bytes."""
        os = await self._open_object_store_or_none(bucket_name)
        if not os:
            return None
        try:
            result = await os.get(name)
        except Exception as e:
            if 'NotFound' in type(e).__name__ or 'not found' in str(e).lower():
                return None
            raise
        if not result:
            return None
        return result.data

    async def get_object_stream(
        self,
        bucket_name: str,
        name: str,
        writeinto: io.BufferedIOBase
    ) -> Optional[ObjectInfo]:
        """Retrieve an object by streaming directly into a writable buffer."""
        os = await self._open_object_store_or_none(bucket_name)
        if not os:
            return None
        try:
            result = await os.get(name, writeinto=writeinto)
        except Exception as e:
            if 'NotFound' in type(e).__name__ or 'not found' in str(e).lower():
                return None
            raise
        if not result:
            return None
        return result.info

    async def get_object_info(self, bucket_name: str, name: str) -> Optional[ObjectInfo]:
        """Get object metadata."""
        os = await self._open_object_store_or_none(bucket_name)
        if not os:
            return None
        try:
            return await os.info(name)
        except Exception as e:
            if 'NotFound' in type(e).__name__ or 'not found' in str(e).lower():
                return None
            raise

    async def delete_object(self, bucket_name: str, name: str) -> None:
        """Delete an object from a bucket."""
        os = await self.get_object_store(bucket_name)
        await os.delete(name)
        info(f"Object deleted: {bucket_name}/{name}")

    async def list_objects(self, bucket_name: str) -> List[ObjectInfo]:
        """List all objects in a bucket."""
        os = await self.get_object_store(bucket_name)
        return await os.list()
