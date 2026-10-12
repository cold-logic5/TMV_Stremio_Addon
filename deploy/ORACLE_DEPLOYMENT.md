# Deploying InMax on Oracle Cloud (Always Free, 24/7)

## 1. Create the VM (Oracle Console)
1. Sign up at https://www.oracle.com/cloud/free/ (credit card needed for verification only).
2. **Compute -> Instances -> Create instance**
   - Image: **Ubuntu 22.04** (or 24.04)
   - Shape: **VM.Standard.A1.Flex** (ARM, 1 OCPU / 6 GB is plenty) or **VM.Standard.E2.1.Micro** (AMD). Both are "Always Free eligible".
   - Networking: keep "Assign a public IPv4 address" enabled.
   - SSH keys: upload your public key (`~/.ssh/id_ed25519.pub`) or let Oracle generate one and download it.
   - If A1 shows "Out of capacity", retry later or try another availability domain, or use the AMD Micro shape.
3. Note the **public IP**.

## 2. Open ports 80 and 443 (Oracle network)
**Networking -> Virtual Cloud Networks -> your VCN -> Subnet -> Security List -> Add Ingress Rules**
- Source CIDR `0.0.0.0/0`, TCP, destination port `80`
- Source CIDR `0.0.0.0/0`, TCP, destination port `443`

## 3. Get a domain (HTTPS is required by Stremio)
Pick one:
- **No signup:** use `<ip-with-dashes>.sslip.io`, e.g. IP `129.151.10.20` -> `129-151-10-20.sslip.io`
- **Free named domain:** create one at https://www.duckdns.org pointing to the public IP, e.g. `inmax.duckdns.org`

## 4. Run the setup script
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<PUBLIC_IP>
curl -fsSL https://raw.githubusercontent.com/cold-logic5/TMV_Stremio_Addon/main/deploy/setup-oracle.sh -o setup.sh
bash setup.sh 129-151-10-20.sslip.io     # <- your domain
```
> The script is pulled from GitHub, so push these deploy files first (`git push origin main`).

It installs Node 20, PM2, and Caddy, builds the app, starts it, enables auto-start on reboot, and sets up HTTPS.

## 5. Verify and install
- Open `https://<your-domain>/manifest.json`
- In Stremio: **Addons -> paste the URL**

## Day-to-day operations
```bash
pm2 status                 # is it running?
pm2 logs inmax-addon       # live logs
cd ~/TMV_Stremio_Addon && git pull && npm ci && npm run build && pm2 restart inmax-addon   # deploy code changes
```
- **Catalog updates need no action.** The GitHub Actions scraper pushes `data/movies.json`, and the server re-fetches it from `DATA_URL` every 15 minutes.
- Oracle may reclaim idle Always Free VMs. Your app makes outbound requests regularly, which helps, but check on it occasionally.

## After it works
- Remove the Render service (or leave `render.yaml` as a backup).
- Update the manifest URL for users if it changed.
