/**
 * Row builders for the unit tests. Pure, like everything else in `src/core`:
 * they only assemble the plain objects from §3 with sensible defaults so each
 * test can state just the field it is about.
 */

import type {
  Area,
  Checkin,
  Freeze,
  Goal,
  Snapshot,
  Subgoal,
} from './types'

export function area(over: Partial<Area> = {}): Area {
  return { id: 1, name: 'Health', position: 0, ...over }
}

export function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    area_id: 1,
    title: 'Reach 100 kg bench press',
    description: '',
    status: 'active',
    created_at: '2000-01-01',
    ...over,
  }
}

export function subgoal(over: Partial<Subgoal> = {}): Subgoal {
  return {
    id: 1,
    area_id: 1,
    goal_id: 1,
    title: 'Gym session',
    importance: 'medium',
    cadence_type: 'weekly',
    interval: 1,
    days: [],
    monthly_day: null,
    month_weekday: null,
    month_ordinal: null,
    due_date: null,
    start_date: null,
    repeat_until: null,
    time: null,
    weight: null,
    created_at: '2000-01-01',
    archived: false,
    ...over,
  }
}

/** The same builder under the name the app now uses for the row. */
export const task = subgoal

export function checkin(over: Partial<Checkin> & Pick<Checkin, 'date'>): Checkin {
  return { subgoal_id: 1, status: 'done', ...over }
}

export function freeze(over: Partial<Freeze> & Pick<Freeze, 'start_date'>): Freeze {
  return { id: 1, goal_id: 1, end_date: null, ...over }
}

export function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
  return {
    areas: parts.areas ?? [area()],
    goals: parts.goals ?? [goal()],
    subgoals: parts.subgoals ?? [],
    checkins: parts.checkins ?? [],
    freezes: parts.freezes ?? [],
  }
}
