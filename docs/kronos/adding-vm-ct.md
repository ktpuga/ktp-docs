---
sidebar_position: 3
title: Adding VMs & CTs
description: Proxmox fun!
---

# Adding VMs & Containers

## Requirements

- You must receive explicit permission from the **current Infrastructure Chair** before creating or modifying any VM/container or changing resource allocations.
- You must have Proxmox access at `https://proxmox.ugaktp.com`.

## Steps

### 1) Decide: Container vs VM

We **almost always choose LXC containers**. Create a VM only when a container cannot meet the requirements.

Choose an **LXC container** when:

- The service runs on Ubuntu/Debian without kernel changes
- You want low overhead and fast provisioning
- You do not need passthrough or nested virtualization

Choose a **VM** only when:

- You need a different kernel or OS distribution
- You require kernel modules, GPU/PCIe passthrough, or nested virtualization
- You need stricter isolation for high-risk experiments

### 2) Reserve an ID and name

- Use the next available Proxmox ID. Or any ID that sounds reasonable. (Consult Infra Chair)
- Name should be short, lowercase, and service-oriented (e.g., `immich`, `dokploy`, `authentik`, `minecraft`).
- Add a note in Proxmox with the owner, purpose, and contact.

### 3) Allocate resources (baseline)

Start small. These baselines fit most services.

> You can always increase hardware allocation, start low please.

**LXC container (default):**

- **CPU:** 1–2 cores
- **RAM:** 1–4 GB
- **Disk:** 8–32 GB
- **Swap:** 0–1 GB (only if the service is memory-spiky)

**VM (only if required):**

- **CPU:** 2–4 cores
- **RAM:** 4–8 GB
- **Disk:** 32–64 GB
- **GPU / PCIe:** only with explicit approval

If the service has known requirements (databases, media processing, CI runners), adjust and document the rationale in Proxmox notes.

### 4) Create the container (preferred)

1. In Proxmox: **Create CT**
2. Select preferred OS. (Debian or Ubuntu)
3. Set hostname, root password (which **must match other containers** unless explicitly told not to), and network settings which diff widely depending on the purpose of the container.
4. Apply the baseline resource allocation
5. Start the container, then install dependencies and configure services.

> Make sure to run ping 1.1.1.1 to make sure internet is reaching the container before continuing

### 5) Create the VM (only when necessary)

1. In Proxmox: **Create VM**
2. Select the OS ISO (usually **Ubuntu Server 24.04 LTS**)
3. Allocate CPU, RAM, and disk based on the VM guidelines
4. Enable QEMU guest agent
5. Install the OS, apply updates, and harden SSH

### 6) Post-provision checklist

- Add the service to **Traefik** if it needs external access (Mainly for HTTP/HTTPS connections)
- Add a **backup + snapshot schedule**
- Record owner, purpose, and any special config in Proxmox notes (if necessary)
- Update `docs/kronos/services.md` once it exists

## Troubleshooting

- **Service is slow or crashing:** Check resource usage, logs, and consider scaling CPU/RAM/disk.
- **No network access:** Verify IP, gateway, and DNS in the container/VM config.
- **Port conflicts:** Confirm Traefik routing and exposed ports.
- **Storage full:** Resize disk in Proxmox and grow the filesystem in the guest.
- **Traefik changes:** Be extremely cautious when editing `dynamic.yml`. A YAML error can break routing for everything, including `https://proxmox.ugaktp.com`, which may force a manual SSH fix.

## Additional Notes

- Keep resource changes minimal unless there is a clear performance need.
- Always document exceptions to the default baselines.
