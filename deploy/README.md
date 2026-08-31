# Deploying

The public site is static, so deploying is copying files. Nothing is compiled
on the server — it has 2 cores and under 1 GB of RAM, and a build there would
be slow and risky.

## One-time server setup

Not yet applied. Blocked on two things that need a human:

1. **Open 80/443 in the OCI console** — VCN → Security Lists → Ingress Rules.
   The local firewall alone is not enough; OCI drops the traffic upstream
   before it reaches the machine.
2. **Point a domain at the server.** HTTPS needs a real hostname; Let's Encrypt
   will not issue a certificate for a bare IP.

Then, on the server:

```bash
# swap first — the box has none, and no swap means an OOM kill instead of a
# slowdown when anything spikes
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Caddy: automatic HTTPS, ~15 MB resident, replaces nginx + certbot
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## Configuration

`deploy/Caddyfile` is a template. Copy it to the server and substitute the real
domain — the domain is not committed here, because this repo is public.

## Publishing

```bash
./deploy/deploy.sh
```

It builds locally, then rsyncs `dist/` to the server. `--delete` removes files
that no longer exist in the build, so renamed articles do not linger.

## Pulling content back

Articles written in the admin live on the server. Sync them back into git so
the writing is not stored in exactly one place, on a free-tier VM:

```bash
./deploy/pull-content.sh
```
