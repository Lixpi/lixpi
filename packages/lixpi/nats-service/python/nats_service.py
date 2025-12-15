"""
NATS Service Client for Python
Shared implementation mirroring TypeScript version with optional self-issued JWT authentication.
"""

import asyncio
import io
import json
import time
import base64
from typing import Any, Dict, Optional, Callable, List, Union
from enum import Enum

import nats
from nats.aio.client import Client as NATS
from nats.aio.msg import Msg
from nats.js import JetStreamContext
from nats.js.api import ObjectStoreConfig, ObjectInfo, ObjectMeta
from nats.js.object_store import ObjectStore
from nkeys import from_seed
from colorama import Fore, Style
from lixpi_debug_tools import log, info, info_str, warn, err


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
            # Used by services that need cryptographically signed authentication
            info("Generating self-issued JWT...")
            options["token"] = generate_self_issued_jwt(
                nkey_seed=self.config.nkey_seed,
                user_id=self.config.user_id,
                expiry_hours=1
            )
            info(f"Using self-issued JWT for user: {self.config.user_id}")
        elif self.config.token:
            # Priority 2: Pre-generated JWT token
            # Used when token is already available from external source
            options["token"] = self.config.token
        elif self.config.user and self.config.password:
            # Priority 3: Basic username/password authentication
            # Legacy auth method, less secure than JWT
            options["user"] = self.config.user
            options["password"] = self.config.password
        # If none provided, connection will be attempted without authentication

    async def connect(self, initial_connect_timeout: int = 2) -> None:
        """
        Connect to NATS server. Does not crash on failure, schedules reconnection.

        Args:
            initial_connect_timeout: Timeout for initial connection in seconds
        """
        if self._is_connecting or self.is_connected():
            return

        self._is_connecting = True

        try:
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
            err(f"NATS -> connection error or timeout: {error}")
            self._schedule_reconnect()
        finally:
            self._is_connecting = False

    async def disconnect(self) -> None:
        """Disconnect from NATS server."""
        if self.nc and not self.nc.is_closed:
            await self.nc.close()
            info("NATS disconnected gracefully.")

    async def drain(self) -> None:
        """Drain all subscriptions and disconnect."""
        if self.nc and not self.nc.is_closed:
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

    async def create_object_store(
        self,
        bucket_name: str,
        options: Optional[ObjectStoreConfig] = None
    ) -> ObjectStore:
        """Create an Object Store bucket."""
        js = self._get_jetstream()
        if options:
            os = await js.create_object_store(bucket_name, config=options)
        else:
            os = await js.create_object_store(bucket_name)
        info(f"Object Store bucket created: {bucket_name}")
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
        os = await self.get_object_store(bucket_name)
        result = await os.get(name)
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
        os = await self.get_object_store(bucket_name)
        result = await os.get(name, writeinto=writeinto)
        if not result:
            return None
        return result.info

    async def get_object_info(self, bucket_name: str, name: str) -> Optional[ObjectInfo]:
        """Get object metadata."""
        os = await self.get_object_store(bucket_name)
        return await os.info(name)

    async def delete_object(self, bucket_name: str, name: str) -> None:
        """Delete an object from a bucket."""
        os = await self.get_object_store(bucket_name)
        await os.delete(name)
        info(f"Object deleted: {bucket_name}/{name}")

    async def list_objects(self, bucket_name: str) -> List[ObjectInfo]:
        """List all objects in a bucket."""
        os = await self.get_object_store(bucket_name)
        return await os.list()
