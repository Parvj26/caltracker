import { formatWeight, streakLabel, type Units } from '@caltracker/shared';
import { LocalDate } from '@/app/(coach)/workouts/local-date';
import { Card } from '@/components/ui';
import type { ClientStickers } from '@/lib/client-stickers';
import styles from './stickers-panel.module.css';

/** The client's streak, zoo book and personal bests (read-only; the phone earns them). */
export function StickersPanel({ data, units }: { data: ClientStickers; units: Units }) {
  return (
    <div className={styles.wrap}>
      <Card className={styles.card} aria-labelledby="streak-heading">
        <h2 id="streak-heading" className={styles.heading}>Streak &amp; stickers</h2>
        <p className={styles.streak}>
          <span aria-hidden="true">🔥 </span>
          {streakLabel(data.streak)}
        </p>
        {data.bestStreak > data.streak ? <p className={styles.caption}>Best: {data.bestStreak} weeks</p> : null}
        <p className={styles.caption}>
          Zoo book: {data.collected} of {data.total} stickers
        </p>
        {data.recent.length === 0 ? (
          <p className={styles.caption}>No stickers yet. They arrive as the client finishes workouts.</p>
        ) : (
          <ul className={styles.stickers} aria-label="Latest stickers">
            {data.recent.map((s) => (
              <li key={s.key} className={styles.sticker}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small static WebP from /public, like the exercise images */}
                <img src={`/stickers/${s.key}-sm.webp`} alt={s.name} width={64} height={64} loading="lazy" />
                <span className={styles.stickerName}>{s.name}{s.shiny ? ' ✨' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className={styles.card} aria-labelledby="bests-heading">
        <h2 id="bests-heading" className={styles.heading}>Personal bests</h2>
        {data.bests.length === 0 ? (
          <p className={styles.caption}>No personal bests yet.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table} aria-label="Personal bests">
              <thead>
                <tr>
                  <th scope="col">Exercise</th>
                  <th scope="col">Best</th>
                  <th scope="col">Est. 1RM</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.bests.map((b) => (
                  <tr key={b.exerciseId}>
                    <th scope="row">{b.name}</th>
                    <td className={styles.numeric}>{b.weightKg !== null ? `${formatWeight(b.weightKg, units)} × ${b.reps ?? 1}` : '–'}</td>
                    <td className={styles.numeric}>{b.e1rmKg !== null ? formatWeight(b.e1rmKg, units) : '–'}</td>
                    <td className={styles.numeric}><LocalDate iso={b.achievedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
