/** The Help page's how-tos. Keep each step in the words the app's own buttons use. */
export type HowTo = { title: string; steps: string[]; link: { href: string; label: string } };

export const HOW_TOS: HowTo[] = [
  {
    title: 'Invite a client',
    steps: [
      'Open Clients and tap + Invite client.',
      'Type their first and last name and their email. You can also pick a program for them to start on.',
      'Tap Send invite. They get an email with a link to join, and show as Invited on Clients until they do.',
    ],
    link: { href: '/clients', label: 'Go to Clients' },
  },
  {
    title: 'Assign a program',
    steps: [
      'Open Programs and tap Assign on the program.',
      'Pick one or more clients, then the start date.',
      'Their calendar fills in. Days that already have a workout keep it.',
    ],
    link: { href: '/programs', label: 'Go to Programs' },
  },
  {
    title: 'Log a session in person',
    steps: [
      'On Home, tap Log session next to the client under Today. Or open the client, go to Training and pick Log session from the workout’s ⋯ menu.',
      'Tick each set as they finish it. If they lifted a different weight or did different reps, change the numbers first.',
      'Tap Finish session at the end. It shows as done on their calendar.',
    ],
    link: { href: '/home', label: 'Go to Home' },
  },
  {
    title: 'Message a client',
    steps: [
      'Open Messages and pick the client. Or tap Message at the top of their page.',
      'Type your message and tap Send. The 📎 button adds up to 4 photos.',
      'A red number on Messages means replies you haven’t read yet.',
    ],
    link: { href: '/messages', label: 'Go to Messages' },
  },
  {
    title: 'Add a body scan',
    steps: [
      'Open the client and go to their Body tab.',
      'Tap Add scan and type in the numbers from the InBody printout. You can attach the printout too.',
      'Tap Save scan. Once there are two scans, charts show how each number changed.',
    ],
    link: { href: '/clients', label: 'Go to Clients' },
  },
];
