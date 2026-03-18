// src/reminders/ReminderScheduler.ts
import { loadReminders, saveReminders, updateReminderStatus } from './ReminderStore.js';
import { Reminder } from '../types/index.js';

export class ReminderScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /** Вызвать один раз при старте MCP-сервера */
  async initialize(): Promise<void> {
    const reminders = await loadReminders();
    const now = Date.now();

    const updated: Reminder[] = reminders.map((r) => {
      if (r.status !== 'pending') return r;

      const remaining = new Date(r.scheduledAt).getTime() - now;

      if (remaining <= 0) {
        // Уже просрочено — сразу fired
        return { ...r, status: 'fired' as const };
      }

      this.scheduleTimer(r.id, remaining);
      return r;
    });

    await saveReminders(updated);
  }

  /** Запланировать новое напоминание */
  schedule(id: string, delayMs: number): void {
    this.scheduleTimer(id, delayMs);
  }

  /** Отменить напоминание */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(id);
    return true;
  }

  private scheduleTimer(id: string, delayMs: number): void {
    const timer = setTimeout(async () => {
      this.timers.delete(id);
      await updateReminderStatus(id, 'fired');
    }, delayMs);
    // Не блокировать process.exit
    if (timer.unref) timer.unref();
    this.timers.set(id, timer);
  }
}
