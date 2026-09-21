# IMD gateway

A forwarder with a fixed IP address. It exists because Vercel functions call
out from a large, changing pool of addresses, and an API that allowlists
callers by IP cannot be reached from them.

It is transport only. It holds no credentials, signs in to nothing, and reads
no field of any response. Chaatak keeps every piece of weather and warning
logic, because a second place that understands warnings is a second place that
can get them wrong — and it would be the one without the tests.

```
Vercel (chaatak.com)  ──►  EC2 + Elastic IP  ──►  api.imd.gov.in
   holds credentials        adds nothing           allowlists one address
   parses warnings          forwards the path
```

## What to create

- One EC2 instance, `t4g.nano` or `t3.micro` is ample — this proxies a handful
  of requests a minute.
- One **Elastic IP**, associated with it. This is the whole point: without it
  the address changes when the instance restarts and the allowlist goes stale.
- A security group allowing inbound **443** (or 8080 behind a load balancer)
  and outbound 443. Nothing else, and in particular not SSH from anywhere.

Give IMD the Elastic IP for their allowlist.

## Setup on the instance

```bash
sudo dnf install -y nodejs        # Amazon Linux 2023; apt on Ubuntu
sudo mkdir -p /opt/imd-gateway
sudo cp server.mjs /opt/imd-gateway/

# A long random shared secret. This is what stops the box being an open relay.
openssl rand -hex 32              # keep the output; it becomes IMD_GATEWAY_TOKEN
```

Run it under systemd so it survives a reboot:

```ini
# /etc/systemd/system/imd-gateway.service
[Unit]
Description=IMD gateway
After=network-online.target

[Service]
Environment=GATEWAY_TOKEN=<the secret from above>
Environment=PORT=8080
# Behind a TLS terminator, bind loopback only: a firewall rule is one edit
# away from exposing the plaintext port, and a loopback bind is not.
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node /opt/imd-gateway/server.mjs
Restart=always
User=nobody
# It needs nothing from the disk and nothing from the rest of the system.
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now imd-gateway
curl -s localhost:8080/health      # {"ok":true}
```

## TLS

Chaatak sends a bearer token to this host, so the hop must be encrypted. Put
it behind one of:

- **Caddy** on the instance, which gets a certificate automatically:
  `caddy reverse-proxy --from gateway.example.com --to localhost:8080`
- An **Application Load Balancer** with an ACM certificate.

Plain HTTP is acceptable only if you are testing and the token is disposable.
A bearer token over cleartext is a credential handed to anyone on the path.

## Point Chaatak at it

Set both, in Vercel **Production**:

```
IMD_GATEWAY_URL    = https://gateway.example.com
IMD_GATEWAY_TOKEN  = <the secret>
```

Both or neither. Chaatak treats a URL without a token as not configured,
because a gateway that refuses every request is a slower and more confusing
failure than no gateway at all.

Unset them and Chaatak calls `api.imd.gov.in` directly, which is what happens
locally and is exactly the same code path.

## Checking it

From your laptop, against the deployed gateway:

```bash
IMD_GATEWAY_URL=https://gateway.example.com \
IMD_GATEWAY_TOKEN=<secret> \
npm run verify:imd
```

The `transport` row of the table will say `via gateway …`, and the sign-in and
district warning rows then tell you whether IMD accepts requests from that
address.
