import Heading from '@theme/Heading';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Ascii: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'KTP Knowledge Server',
    Ascii: String.raw`
┌─────────────────────────┐
│   KTP KNOWLEDGE SERVER  │
├─────────────────────────┤
│ [📄]  Docs               │
│ [📜]  Governance         │
│ [⚙️]  Engineering        │
│ [𝌵]  Rituals            │
└─────────────────────────┘`,
    description: (
      <>
        Centralized documentation for the Phi Chapter. Everything you need in
        one place.
      </>
    ),
  },
  {
    title: 'Phi Chapter Banner',
    Ascii: String.raw`
╔══════════════════════════╗
║   Κ Θ Π — PHI CHAPTER    ║
║    Knowledge Tenacity    ║
║          Passion.        ║
╚══════════════════════════╝`,
    description: (
      <>
        An ASCII crest representing our identity, history, and professional
        mission.
      </>
    ),
  },
  {
    title: 'KTP Terminal Output',
    Ascii: String.raw`
> ktp --init
[ OK ] Docs loaded
[ OK ] Article Amended
[ INFO ] Danny lost the 🧀...
[ WARN ] Low on snacks
> KTP - Status: We'll survive`,
    description: (
      <>
        A hacker-style terminal aesthetic to reflect our engineering culture.
      </>
    ),
  },
];

function Feature({ title, Ascii, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <pre className={styles.asciiBlock}>{Ascii}</pre>
      </div>
      <div className="text--center padding-horiz--md">
        {/* <Heading as="h3">{title}</Heading> */}
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
