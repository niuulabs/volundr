# Flock / Mesh Networking

The Flock system enables multiple Ravn instances to discover each other, form
clusters, and communicate. Mesh networking handles message transport between
peers, while discovery handles finding and verifying peers.

## Mesh Transport

Mesh provides three operations for inter-agent communication:

| Method | Description |
|--------|-------------|
| `publish(topic, payload)` | Broadcast to all peers subscribed to a topic. |
| `subscribe(topic, handler)` | Listen for messages on a topic. |
| `send(peer_id, payload)` | RPC-style direct message to a specific peer. |

### Transport Adapters

| Adapter | Use Case | Protocol |
|---------|----------|----------|
| `nng` | Pi mode / local network | nng PUB/SUB + REQ/REP sockets |
| `sleipnir` | Infrastructure mode | RabbitMQ exchanges |
| `composite` | Hybrid | Tries Sleipnir first, falls back to nng |

Configure via:

```yaml
mesh:
  enabled: true
  adapter: nng          # nng | sleipnir | composite
  rpc_timeout_s: 10.0
  own_peer_id: ""       # auto: hostname

  nng:
    pub_address: "tcp://*:9001"
    sub_address: "tcp://*:9002"
    req_address: "tcp://*:9003"
    realm_key_env: "RAVN_REALM_KEY"
    heartbeat_interval_s: 15.0

  sleipnir:
    amqp_url_env: "SLEIPNIR_AMQP_URL"
    exchange: "ravn.mesh"
    rpc_timeout_s: 10.0
```

## Peer Discovery

Discovery finds and verifies other Ravn instances in the network.

| Method | Description |
|--------|-------------|
| `announce()` | Advertise presence to the network. |
| `scan()` | Search for peers. |
| `watch(handler)` | Receive notifications when peers join/leave. |
| `handshake(candidate)` | Verify a candidate peer's identity. |
| `peers()` | Get current list of verified peers. |

### Discovery Adapters

| Adapter | Use Case | Mechanism |
|---------|----------|-----------|
| `mdns` | Local network (Pi mode) | Zeroconf + HMAC handshake |
| `sleipnir` | Infrastructure mode | RabbitMQ pub/sub + SPIFFE JWT |
| `k8s` | Kubernetes | Pod label selector |
| `composite` | Multiple backends | Union of all adapters |

### mDNS Discovery (Pi Mode)

Uses Zeroconf to advertise `_ravn._tcp.local.` services. Peers authenticate
via HMAC handshake using a shared realm key.

```yaml
discovery:
  adapter: mdns
  heartbeat_interval_s: 30.0
  peer_ttl_s: 90.0
  mdns:
    service_instance: "ravn-pi-01"
    port: 9001
    realm_key_env: "RAVN_REALM_KEY"
```

### Kubernetes Discovery

Discovers peers via Kubernetes API — queries pods matching a label selector.

```yaml
discovery:
  adapter: k8s
  k8s:
    namespace: ravn
    label_selector: "app=ravn-agent"
    service_port: 9001
```

### Sleipnir Discovery

Peers announce themselves via RabbitMQ heartbeats. Authentication uses
SPIFFE JWTs for identity verification.

```yaml
discovery:
  adapter: sleipnir
  sleipnir:
    amqp_url_env: "SLEIPNIR_AMQP_URL"
    exchange: "ravn.discovery"
    trust_domain: "ravn.niuulabs.com"
```

## Security

| Discovery | Authentication |
|-----------|---------------|
| mDNS | HMAC handshake (shared `realm_key`) |
| Sleipnir | SPIFFE JWT verification |
| Kubernetes | Service account + namespace isolation |

## Flock Commands

Use `ravn peers` to inspect the flock:

```bash
# Quick peer list
ravn peers

# Detailed info with fresh scan
ravn peers -v --scan
```

## Configuration

See the [Configuration Reference](../configuration/reference.md#mesh) for
`mesh.*` and `discovery.*` fields.

Related: [NIU-517](https://linear.app/niuulabs/issue/NIU-517), [NIU-538](https://linear.app/niuulabs/issue/NIU-538)
