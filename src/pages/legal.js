/**
 * /privacy and /terms. Written for the features actually implemented.
 * Sections marked "Operator review required" must be completed by the
 * site operator (identity, jurisdiction, legal bases, contact details).
 */
import { h, link } from '../utils/dom.js';
import { config } from '../lib/config.js';
import { LIMITS } from '../lib/world-model.js';

const review = (text) => h('p', { class: 'review-note' }, h('strong', {}, 'Operator review required: '), text);

function privacy() {
  return [
    h('p', { class: 'muted fine' }, 'Last updated: 20 October 2026'),
    review('Add the legal name and address of the operator, a contact email, your jurisdiction, the legal bases you rely on (for example legitimate interest for abuse prevention, contract for accounts), and your data processors’ details. Have this policy checked by a qualified person.'),
    h('h2', {}, 'Who runs this site'),
    h('p', {}, `Internet Organism is operated by ${config.operatorName}.`, config.contactEmail ? [' Contact: ', h('a', { href: `mailto:${config.contactEmail}` }, config.contactEmail), '.'] : ''),
    h('h2', {}, 'What we collect'),
    h('ul', {},
      h('li', {}, h('strong', {}, 'Anonymous participation. '), 'You can leave traces without any account or sign-in. To apply fair limits, the server computes a pseudonymous key from your connection’s IP address using a keyed one-way hash (HMAC-SHA256 with a secret that never leaves the database). The IP address itself is not stored by us; the key cannot be turned back into it without that secret. Everyone sharing a connection shares the key and its limits.'),
      h('li', {}, h('strong', {}, 'Accounts (optional). '), 'Email address and a password hash (handled by Supabase Auth), or the identity from an OAuth provider if you choose one. Your email is never shown publicly.'),
      h('li', {}, h('strong', {}, 'Traces. '), 'Region, colour, pattern, intensity, persistence, energy added, time, your pseudonym at that moment, and either your account id or the pseudonymous connection key. The public sees everything except the id/key.'),
      h('li', {}, h('strong', {}, 'Profile and preferences. '), 'Your pseudonym and, if signed in, your display preferences and saved discoveries.'),
      h('li', {}, h('strong', {}, 'Reports. '), 'If you report content: the target, reason, optional details and your account id. Only moderators can see reports.'),
      h('li', {}, h('strong', {}, 'Abuse controls. '), 'Counts of rejected requests per account per hour (reason and count only). Our own database does not store IP addresses. Supabase, as our infrastructure provider, processes IP addresses in its logs and for its own rate limits on sign-ups.'),
      h('li', {}, h('strong', {}, 'Errors. '), 'Short technical error messages and the page path, without personal data, so we can fix problems.'),
      h('li', {}, h('strong', {}, 'Usage counts (if enabled). '), 'Daily totals of a few actions such as “trace submitted” — no ids, no cookies, no IP addresses. You can opt out in Settings; Global Privacy Control / Do Not Track are respected.'),
      h('li', {}, h('strong', {}, 'Payments (if enabled). '), 'Our payment provider processes your payment details; we never receive card numbers. We store the provider’s payment id, the amount, currency, and — only if you opt in — the name you want shown on the supporters list.')),
    h('h2', {}, 'What is public'),
    h('p', {}, 'Your pseudonym, trace appearance, region and time appear in the shared world and its event history. Discoveries your trace triggers show your pseudonym. Choose a pseudonym you are comfortable sharing.'),
    h('h2', {}, 'Retention'),
    h('ul', {},
      h('li', {}, 'Individual trace events in the public stream: 30 days. Aggregate region and world statistics and milestone discoveries are kept for the life of the project.'),
      h('li', {}, 'Your traces: kept while your account exists; on deletion they are detached from you and renamed “Former visitor”.'),
      h('li', {}, 'Rate-limit counters: 14 days. Error log: 30 days. Usage counts: 400 days.'),
      h('li', {}, 'Pseudonymous connection keys stay attached to anonymous traces (they are what makes “distinct visitors” countable). They cannot be linked to an IP address without the database secret.')),
    h('h2', {}, 'Your choices and rights'),
    h('ul', {},
      h('li', {}, 'Use the site without an account, and turn off usage counts in ', link('/settings', {}, 'Settings'), '.'),
      h('li', {}, 'Change your pseudonym on your profile.'),
      h('li', {}, 'Delete your account at any time in Settings. Anonymous traces are not linked to you, so there is nothing personal to delete; ask the operator if you have a concern.'),
      h('li', {}, 'Contact the operator to request access to or correction of your data.')),
    review('List the rights that apply in your jurisdiction (for example under the GDPR/UK GDPR or CCPA), how to exercise them, and how to complain to a supervisory authority.'),
    h('h2', {}, 'Cookies and storage'),
    h('p', {}, 'We do not use advertising or tracking cookies. Local storage holds your preferences, a list of traces left from this browser, small conveniences such as whether you hid the introduction, and — only if you sign in — your session token. In demo mode the whole demo world is stored locally.'),
    h('h2', {}, 'Processors'),
    h('p', {}, 'Supabase (database, authentication, realtime), Vercel (hosting), and — only if configured — a payment provider and Plausible Analytics.'),
  ];
}

function terms() {
  return [
    h('p', { class: 'muted fine' }, 'Last updated: 20 October 2026'),
    review('Add the operator’s identity, governing law and venue, and age requirements for your jurisdiction. Have these terms checked by a qualified person.'),
    h('h2', {}, 'The service'),
    h('p', {}, 'Internet Organism is a shared, experimental digital world provided free of charge, as is, without guarantees of availability. The world can change, slow down, be paused or reset if necessary for safety or technical reasons; we will record such events in the timeline where possible.'),
    h('h2', {}, 'Community rules'),
    h('ul', {},
      h('li', {}, 'No offensive, hateful, harassing or impersonating pseudonyms.'),
      h('li', {}, 'No automated submissions, scripts or bots, and no attempts to get around limits (for example by creating many sessions).'),
      h('li', {}, 'No attempts to access data or functions you are not authorised to use.'),
      h('li', {}, 'Respect that the world belongs to everyone: no single person should try to dominate it.')),
    h('h2', {}, 'Limits'),
    h('p', {}, `Anonymous visitors may leave one trace every ${LIMITS.anonymous.cooldownSeconds} seconds, up to ${LIMITS.anonymous.perHour} per hour and ${LIMITS.anonymous.perDay} per UTC day, per connection; accounts ${LIMITS.account.cooldownSeconds} seconds, ${LIMITS.account.perHour} per hour and ${LIMITS.account.perDay} per day. Limits may change to protect the service.`),
    h('h2', {}, 'Moderation'),
    h('p', {}, 'Anyone with a session can report public content. Moderators can hide events or discoveries and replace abusive pseudonyms everywhere they appear. Sensitive moderator actions are recorded in an internal audit log. We may suspend accounts that break these rules.'),
    h('h2', {}, 'Your content'),
    h('p', {}, 'Traces are small, structured contributions (colour, pattern, intensity, region). By leaving one, you allow it to be displayed as part of the shared world and its history, including after you leave, in anonymised form if you delete your account.'),
    h('h2', {}, 'Support payments'),
    h('p', {}, 'Support is voluntary and gives no control over the shared world. One-time contributions are processed by our payment provider. Refund requests can be sent to the operator within 14 days.'),
    review('Confirm refund, cancellation and consumer-law wording for your jurisdiction and payment provider before enabling payments or memberships.'),
    h('h2', {}, 'Liability'),
    review('Insert a limitation-of-liability clause appropriate to your jurisdiction.'),
    h('h2', {}, 'Changes'),
    h('p', {}, 'We may update these terms; the date above shows the latest version.'),
  ];
}

export function render({ route }) {
  const isPrivacy = route === 'privacy';
  const el = h('article', { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Legal'), h('h1', {}, isPrivacy ? 'Privacy policy' : 'Terms of use')),
    h('div', { class: 'prose' }, isPrivacy ? privacy() : terms()));
  return isPrivacy
    ? { el, title: 'Privacy policy', description: 'What data Internet Organism collects, why, and how long it is kept.' }
    : { el, title: 'Terms of use', description: 'Terms of use, community rules and moderation policy for Internet Organism.' };
}
