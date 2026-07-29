# Intro to KTP Docs

This site is the official living knowledge base for the **Phi Chapter of Kappa Theta Pi**.
It contains everything needed to maintain, improve, and scale our technical, operational, and organizational infrastructure.

If you're a member of **Tech Team**, **Infrastructure**, **Exec**, or a contributor working on Kronos, the KTP website, or internal tools — this is where your documentation goes 😸

---

## 🧭 **Purpose of This Documentation**

Our chapter builds and maintains a _lot_ of systems:

- Physical Server Kronos
  - Internal services via Proxmox: (Immich, GitHub integrations, Personal Sites, and more!)
- Websites (ktp.uga.edu, ugaktp.com, docs, cron jobs, etc.)
- Event infrastructure (KTPHacks, hosting, analytics)
- Member onboarding, (maybe offboarding?) & technical guides

This portal keeps all of that information:

- centralized
- version-controlled
- accessible
- easy to update
- future-proof for new members

---

## 📚 **How to Add Your Documentation**

Every member should contribute. It’s simple:

1. **Create a new Markdown file** inside the appropriate directory under `docs/`.
2. Use a filename that makes sense, e.g.

   ```
   kronos-setup.md
   immich-access.md
   exec-meeting-template.md
   infra-deployment-guide.md
   ```

3. Set `sidebar_position` in the frontmatter to control its ordering. **You don't need to touch `sidebars.ts`** — the sidebar is generated automatically from the folder structure, so a new file in an existing directory shows up on its own. Creating a whole new directory adds a new sidebar category.
4. Write whatever technical, operational, or organizational knowledge you want to preserve.
5. Commit → push → open a PR → merge.

Your additions appear at **[https://docs.ugaktp.com](https://docs.ugaktp.com)** after the next deploy. The site rebuilds and redeploys **automatically every night at midnight**, so a merge during the day goes live that night rather than immediately.

### Where things go

| Directory | Contents |
|---|---|
| `docs/api/` | ktp-api — architecture, schema, endpoint reference |
| `docs/website/` | The Next.js site — portals, messaging, photos/documents, profiles |
| `docs/authentik/` | SSO, enrollment, invitations, group management |
| `docs/kronos/` | Server and infrastructure — Proxmox, containers, Dokploy |
| `docs/operations/` | Runbooks, e.g. member management |
| `docs/exec-board/` | Exec board role responsibilities |

---

## ✍️ **Markdown Template Example (Copy/Paste This)**

Use this as a starter for any new documentation page:

```md
---
sidebar_position: 1
title: <Your Title Here>
description: <1–2 sentence summary>
---

# <Page Title>

## Overview

<Explain what this page covers and why it matters.>

## Requirements

<List any tools, permissions, repos, or knowledge needed.>

## Steps

1. Step one…
2. Step two…
3. Step three…

## Troubleshooting

<Common issues, logs, fixes.>

## Additional Notes

<Links, related pages, warnings, or future plans.>
```

---

## 💡 **Tips for Writing Good Documentation**

- Be specific.
- No AI Slop.
- Use short sections.
- Add examples. (and images if possible)
- Include commands exactly as they should be run.
- Screenshots are welcome (place them in `/static/img`) please keep image file names in lowercase.
- Update your docs whenever you update your systems.

This documentation will outlive your role so write it for the next generation of KTP tech leaders.
