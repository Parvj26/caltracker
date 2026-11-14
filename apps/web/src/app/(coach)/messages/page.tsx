import styles from './messages.module.css';

export const metadata = { title: 'Messages' };

export default function MessagesPage() {
  return <p className={styles.placeholder}>Pick a client to see your conversation.</p>;
}
