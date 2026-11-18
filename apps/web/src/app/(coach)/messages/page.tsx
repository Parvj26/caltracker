import { InboxEmptyPane } from './empty-pane';

export const metadata = { title: 'Messages' };

/** Beside the inbox on iPad and desktop before a conversation is picked (a phone shows the inbox alone). */
export default function MessagesPage() {
  return <InboxEmptyPane />;
}
