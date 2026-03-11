// src/reminders/ReminderStore.ts
import fs from 'fs/promises';
import path from 'path';
import { Reminder } from '../types/index.js';

const STORE_PATH = path.resolve(process.cwd(), '.reminders', 'data.json');

interface StoreData {
  reminders: Reminder[];
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
}

export async function loadReminders(): Promise<Reminder[]> {
  await ensureDir();
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const data: StoreData = JSON.parse(raw);
    return data.reminders ?? [];
  } catch {
    return [];
  }
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(STORE_PATH, JSON.stringify({ reminders }, null, 2), 'utf-8');
}

export async function addReminder(reminder: Reminder): Promise<void> {
  const reminders = await loadReminders();
  reminders.push(reminder);
  await saveReminders(reminders);
}

export async function updateReminderStatus(
  id: string,
  status: Reminder['status']
): Promise<boolean> {
  const reminders = await loadReminders();
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reminders[idx].status = status;
  await saveReminders(reminders);
  return true;
}

export async function getFiredReminders(): Promise<Reminder[]> {
  const reminders = await loadReminders();
  const fired = reminders.filter((r) => r.status === 'fired');

  if (fired.length === 0) return [];

  // Атомарно переводим в shown
  const updated = reminders.map((r) =>
    r.status === 'fired' ? { ...r, status: 'shown' as const } : r
  );
  await saveReminders(updated);
  return fired;
}
