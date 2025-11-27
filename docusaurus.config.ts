import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Phi Docs',
  tagline: 'Never back down never what?',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://docs.ugaktp.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'ktpuga', // Usually your GitHub org/user name.
  projectName: 'ktp-docs', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/ktpuga/ktp-docs/tree/main/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/ktpuga/ktp-docs/tree/main/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ΚΘΠ',
      logo: {
        alt: 'My Site Logo',
        src: 'img/ktp_logo_classic.jpg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Tutorial',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
  type: 'doc',
  docId: 'exec-board/overview',
  label: 'EBoard',
  position: 'left',
},
        {
      type: 'doc',
      docId: 'kronos/overview',   // path inside docs/ folder (no .md)
      position: 'left',
      label: 'Kronos',
        },
        {
          href: 'https://github.com/ktpuga/ktp-docs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Sites',
          items: [
            {
              label: 'KTPGeorgia',
              href: 'https://ktpgeorgia.com',
            }, 
            {
              label: 'Kronos via Proxmox',
              href: 'https://proxmox.ugaktp.com'
            },
            {
              label: 'KTPHacks',
              href: 'https://KTPGeorgia.com/hackathon'
            },
          ],
        },
        {
          title: 'Regulation',
          items: [
            {
              label: 'KTP Phi Chapter Constitution',
              href: 'https://drive.google.com/file/d/17LkRqOsNCJVQUKkWTIOs_HaJhmTcSxmc/view',
            },
            {
              label: 'Code of Conduct',
              href: 'https://KTPGeorgia.com/code-of-conduct',
            },
          ],
        },
        {
          title: 'Nationals',
          items: [
            {
              label: 'KTP.org',
              href: 'https://www.kappathetapi.org/',
            },
            {
              label: 'Slack',
              href: 'https://kappa-theta-pi-hq.slack.com/',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Kappa Theta Pi - Phi Chapter`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
