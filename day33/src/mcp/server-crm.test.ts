import { describe, it, expect } from 'vitest';
import { findUser, findUserTickets } from './server-crm.js';

const users = [
  { id: '1', name: 'Иван Петров', plan: 'Pro', status: 'active', registered: '2024-03-15', email: 'ivan@example.com' },
  { id: '2', name: 'Мария Сидорова', plan: 'Free', status: 'active', registered: '2024-11-01', email: 'maria@example.com' },
];

const tickets = [
  { id: 't1', user_id: '1', subject: 'OAuth не работает', status: 'open', created: '2026-03-28', description: 'Ошибка 500' },
  { id: 't2', user_id: '1', subject: 'Уведомления', status: 'resolved', created: '2026-02-14', description: 'Решено' },
  { id: 't3', user_id: '2', subject: 'Участники', status: 'open', created: '2026-03-30', description: 'Кнопка неактивна' },
];

describe('findUser', () => {
  it('returns user by id', () => {
    const result = findUser(users, '1');
    expect(result?.name).toBe('Иван Петров');
  });

  it('returns null for unknown id', () => {
    expect(findUser(users, '999')).toBeNull();
  });
});

describe('findUserTickets', () => {
  it('returns tickets for user', () => {
    const result = findUserTickets(tickets, '1');
    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe('OAuth не работает');
  });

  it('returns empty array when user has no tickets', () => {
    expect(findUserTickets(tickets, '99')).toEqual([]);
  });
});
