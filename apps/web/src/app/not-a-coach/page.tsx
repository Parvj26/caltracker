import styles from '../(coach)/coach.module.css';

export default function NotACoachPage() {
  return (
    <main className={styles.content}>
      <h1>This dashboard is for coaches. Clients use the CalTracker app.</h1>
      <form action="/auth/sign-out" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
