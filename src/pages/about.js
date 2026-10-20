import { h, link } from '../utils/dom.js';
import { config } from '../lib/config.js';
import { LIMITS } from '../lib/world-model.js';

export function render() {
  const el = h('article', { class: 'page page-narrow' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'About'),
      h('h1', {}, 'What is Internet Organism?'),
      h('p', {}, 'One internet. One living organism. Every human leaves a trace; every trace changes the world.')),
    h('div', { class: 'prose' },
      h('p', {}, 'Internet Organism is a single, persistent digital life form shared by everyone who visits. It is not a social network and not a chatbot. It is a world that exists whether or not you are looking at it, and it changes only because real people do something in it.'),

      h('h2', {}, 'How participation works'),
      h('ul', {},
        h('li', {}, 'Explore without signing up: rotate, zoom, open regions, read discoveries.'),
        h('li', {}, 'Leave a trace: choose a region, a colour, a pattern and an intensity. No account needed — the first time, the site creates an anonymous guest session for you.'),
        h('li', {}, 'The server validates the trace, applies rate limits, records it, updates the region and tells every connected visitor. Only then does the site show that it was accepted.'),
        h('li', {}, 'Optionally create an account to keep your trace history across devices, save discoveries and set a pseudonym. Accounts get slightly higher limits. Paying never gives anyone more control over the shared world.')),

      h('h2', {}, 'What changes the world'),
      h('ul', {},
        h('li', {}, 'Energy: each accepted trace adds a bounded amount of energy to one region. Energy fades over time, so the organism calms down when nobody is around.'),
        h('li', {}, 'Growth: regions grow new branches as their all-time trace count passes fixed thresholds.'),
        h('li', {}, 'Evolution: the whole organism advances through stages when enough traces from enough different visitors have accumulated. New regions form at some stages.'),
        h('li', {}, 'Community events: each UTC day one region hosts a Convergence that completes if enough different visitors take part.')),
      h('p', {}, 'The exact formulas are published on the ', link('/evolution', {}, 'Evolution'), ' page.'),

      h('h2', {}, 'What is simulated, and what is observed'),
      h('p', {}, 'The motion you see — breathing, drifting, light travelling along filaments — is animated locally in your browser from the current world state. It is not a recording and it is not streamed.'),
      h('p', {}, 'The state itself — every region’s energy, level and trace count, every event and discovery, the statistics — comes from the shared database. Statistics are labelled with their time window. Nothing is invented to make the world look busier than it is.'),
      h('p', {}, 'The organism started from a generated structure of six regions. That structure, and anything else the system creates on its own, is labelled “Initial structure” or “System-generated”. Discoveries labelled “Triggered by a visitor” are linked to a specific accepted trace.'),

      h('h2', { id: 'demo' }, 'Demo mode'),
      config.demo
        ? h('p', { class: 'review-note' }, 'This copy of the site is running in demo mode: no shared backend is configured, so the world is stored only in this browser. Other people cannot see your traces, and the numbers describe only this local world.')
        : h('p', {}, 'When the site runs without a configured backend (for development), it switches to a clearly labelled demo mode where the world is stored only in your browser.'),

      h('h2', {}, 'How public data is used'),
      h('p', {}, 'Your trace is shown publicly with a pseudonym (generated, or one you choose), its colour, pattern, region and time. Account email addresses, account ids and IP addresses are never shown in the world. Details are in the ', link('/privacy', {}, 'privacy policy'), '.'),

      h('h2', {}, 'Limits and fairness'),
      h('p', {}, `To keep the world fair, guests can leave one trace every ${LIMITS.guest.cooldownSeconds} seconds (up to ${LIMITS.guest.perHour} per hour and ${LIMITS.guest.perDay} per day) and repeated traces in one region add less energy. These controls make spam expensive; they cannot stop every bot, and the operators can pause contributions if needed.`),

      h('h2', {}, 'Support'),
      h('p', {}, 'The organism is free. If you would like to help cover hosting, see ', link('/support', {}, 'Support'), '.')));
  return { el, title: 'About', description: 'What Internet Organism is, how participation works, what changes the world, and what is simulated versus observed.' };
}
