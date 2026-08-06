# Ubuntu 24.04 LTS VPS Setup Guide for MirrorConnect

Step-by-step administrator guide to provisioning a clean Ubuntu 24.04 LTS VPS for MirrorConnect deployment.

---

## Step 1: System Updates & Prerequisites

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw unzip software-properties-common
```

---

## Step 2: UFW Firewall Setup

Expose necessary HTTP, HTTPS, SSH, and Coturn STUN/TURN ports:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/udp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp
sudo ufw --force enable
```

---

## Step 3: Install Docker & Docker Compose

```bash
# Add Docker official GPG key & repository
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

---

## Step 4: Install Nginx & Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## Step 5: Obtain Let's Encrypt SSL Certificate

```bash
sudo certbot certonly --nginx -d mirror.yourdomain.com --non-interactive --agree-tos -m admin@yourdomain.com
```

---

## Step 6: Clone & Configure MirrorConnect

```bash
cd /opt
sudo git clone https://github.com/your-org/mirrorconnect.git
cd mirrorconnect

# Copy production environment template
cp .env.production .env
```

Edit `.env` and fill in your actual domain, secure passwords, and secrets:

```bash
nano .env
```

---

## Step 7: Launch Docker Compose Stack

```bash
docker compose up -d --build
```

---

## Step 8: Verify Setup

```bash
# Check container status
docker compose ps

# Check API health
curl https://mirror.yourdomain.com/health
```
