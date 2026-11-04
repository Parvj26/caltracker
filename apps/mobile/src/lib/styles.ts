import { StyleSheet } from 'react-native';

// Minimal shared styles; the design system arrives in phase 2.
export const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: '700', color: '#111' },
  body: { fontSize: 16, color: '#333' },
  error: { fontSize: 14, color: '#b00020' },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 12, fontSize: 16, color: '#111' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { padding: 8, alignItems: 'center' },
  linkText: { fontSize: 15, color: '#0a58ca' },
});
