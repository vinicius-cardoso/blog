# Deploying

The public site is static, so deploying is copying files. Nothing is compiled
on the server — it has 2 cores and under 1 GB of RAM, and a build there would
be slow and risky.

## One-time server setup

Already applied. Recorded here so it can be reproduced on a new machine.

Two steps happen outside the server and are easy to forget:

1. **Open 80/443 in the OCI console** — VCN → Security Lists → Ingress Rules.
   The local firewall alone is not enough; OCI drops the traffic upstream
   before it ever reaches the machine. Note the host also has a raw `REJECT`
   rule ahead of the UFW chains, so new `iptables` rules must be inserted
   *above* it or they never match.
2. **Point the domain's A record at the server**, with any CDN proxying
   disabled until the first certificate is issued — Let's Encrypt has to reach
   the machine directly to validate.

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

`deploy/Caddyfile` mirrors what is installed at `/etc/caddy/Caddyfile`. Caddy
obtains and renews the certificate on its own — there is no certbot and no
renewal cron job to forget.

Adding another project on a subdomain is a new block plus a DNS record; Caddy
gets a separate certificate for it automatically.

## Publishing from your laptop

```bash
./deploy/deploy.sh
```

Builds locally, then rsyncs `dist/` to the server. `--delete` removes files
that no longer exist in the build, so renamed articles do not linger. Reads
`deploy/local.conf` (gitignored — it holds the server address).

## Publishing from GitHub

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the
site and rsyncs it here. Three repository secrets drive it:

| Secret | What it is |
|---|---|
| `DEPLOY_KEY` | Private half of a deploy-only SSH key |
| `KNOWN_HOSTS` | The server's host key, pinned rather than trusted on first use |
| `SSH_HOST` | `user@host` for the server |

The matching public key is installed in `~/.ssh/authorized_keys` wrapped in
`rrsync`, restricting it to writing under `/var/www/blog`:

```
command="/usr/bin/rrsync -wo /var/www/blog",restrict ssh-ed25519 AAAA...
```

`-wo` means write-only, `restrict` disables port/agent forwarding and PTY
allocation. A leaked key therefore cannot open a shell, read anything back, or
escape the directory — the worst case is overwriting pages that the next push
regenerates anyway. To revoke it, delete that line from `authorized_keys`.
