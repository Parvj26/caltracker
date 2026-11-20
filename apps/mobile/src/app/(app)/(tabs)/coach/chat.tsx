import { Redirect } from 'expo-router';

// The Coach tab now opens straight into the chat. Old links to /coach/chat (Today's coach card, older pushes) land there.
export default function OldChatRoute() {
  return <Redirect href="/coach" />;
}
