---
sidebar_position: 3
---

# Site Container (ugaktp.com)

The **Site Container** (CT 110) hosts **ugaktp.com**, the main website for Kappa Theta Pi – Phi Chapter at the University of Georgia.

## Overview

This container runs the same repository as **KtpGeorgia.com**, serving as the primary public-facing website for the chapter. It provides information about the organization, events, membership, and more.

## Container Details

- **Container ID:** 110
- **Name:** Site
- **Type:** LXC Container
- **Domain:** ugaktp.com
- **Repository:** Same as KtpGeorgia.com

## Infrastructure

The Site Container (110) is a **clone of the Docs Container (104)** on Proxmox. This means:

- Both containers share similar base configurations
- The same deployment patterns and infrastructure setup
- Consistent security and networking configurations
- Similar maintenance and update procedures

## Deployment

The site container follows similar deployment patterns to the docs container, leveraging:

- Docker-based containerization
- Automated deployment workflows
- Integration with Traefik (CT 100) for reverse proxying
- Regular updates and maintenance cycles

## Access

The site is publicly accessible at:

### **[https://ugaktp.com](https://ugaktp.com)**

For administrative access, connect through Proxmox management interface at [https://proxmox.ugaktp.com](https://proxmox.ugaktp.com).

## Relationship to Docs Container

Since CT 110 is a clone of CT 104 (KTP Docs), many of the same operational principles apply:

- Similar container structure and configuration
- Shared deployment methodologies
- Consistent security practices
- Related maintenance procedures

For more details on the base container setup, see [Docs Site (This Site)](./docs-site.md).
