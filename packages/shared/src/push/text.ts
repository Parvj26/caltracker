import type { OutboxGroup } from './group';

export type PushText = { title: string; body: string };

/**
 * Lock-screen text: who and what, never the content (no message, comment or meal text, no body data or weights).
 * The coach is named by first name, or "your coach" when the name is empty.
 */
export function pushText(group: OutboxGroup): PushText {
  const coach = (group.type === 'daily_reminder' ? '' : group.data.actorName).trim();
  const Coach = coach || 'Your coach';
  const coachLower = coach || 'your coach';
  switch (group.type) {
    case 'workout_assigned':
      return { title: 'New workout assigned', body: `${Coach} assigned you ${group.data.name}.` };
    case 'workout_changed':
      return { title: "Today's workout changed", body: `${Coach} updated ${group.data.workoutName}.` };
    case 'daily_reminder': {
      const more = group.data.more > 0 ? ` + ${group.data.more} more` : '';
      return { title: `Today: ${group.data.workoutName}${more}`, body: 'Your workout is ready. Tap to start.' };
    }
    case 'coach_logged':
      return { title: `${Coach} logged your session`, body: 'Your sticker is waiting.' };
    case 'message':
      return {
        title: `Message from ${coachLower}`,
        body: group.count > 1 ? `${Coach} sent you ${group.count} messages.` : `${Coach} sent you a message.`,
      };
    case 'workout_comment':
      return { title: 'Comment on your workout', body: `${Coach} commented on ${group.data.workoutName}.` };
    case 'meal_comment':
      return { title: 'Comment on your meal', body: `${Coach} commented on your ${group.data.mealName}.` };
    case 'food_targets':
      return { title: 'New food targets', body: `${Coach} updated your daily targets.` };
    case 'community_coach_post':
      return { title: 'Community', body: `${Coach} posted in ${group.data.communityName}.` };
    case 'community_activity': {
      const who = group.firstActorName || 'Someone';
      const others = Math.max(group.actorIds.length - 1, 0);
      const subject = others === 0 ? who : `${who} and ${others} ${others === 1 ? 'other' : 'others'}`;
      const verb = group.data.activity === 'comment' ? 'commented on' : 'reacted to';
      return { title: 'Community', body: `${subject} ${verb} your post.` };
    }
  }
}
