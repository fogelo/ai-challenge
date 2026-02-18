import React, { useState } from 'react';
import { Box, Text, useInput, Key } from 'ink';
import { Conversation } from '../chat/conversation.js';
import { sendMessage } from '../api/openrouter.js';
import { Message } from '../types/index.js';
import { SKILLS, SkillName } from '../skills/index.js';

function buildSystemPrompt(activeSkills: SkillName[]): string | undefined {
  if (activeSkills.length === 0) return undefined;
  return activeSkills.map((name) => SKILLS[name]).join('\n\n---\n\n');
}

export const Chat: React.FC = () => {
  const [conversation] = useState(() => new Conversation());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSkills, setActiveSkills] = useState<SkillName[]>([]);
  const [notification, setNotification] = useState<string | null>(null);

  function handleSkillCommand(rawInput: string): boolean {
    const trimmed = rawInput.trim();

    if (trimmed === '/skills') {
      if (activeSkills.length === 0) {
        setNotification('Нет активных skills. Используй /skill <name1> <name2>...');
      } else {
        setNotification(`Активные skills: ${activeSkills.join(', ')}`);
      }
      return true;
    }

    if (trimmed.startsWith('/skill ')) {
      const args = trimmed.slice('/skill '.length).trim().split(/\s+/);

      if (args[0] === 'off') {
        setActiveSkills([]);
        setNotification('Skills отключены');
        return true;
      }

      const validSkills = Object.keys(SKILLS) as SkillName[];
      const requested = args.filter((a) => validSkills.includes(a as SkillName)) as SkillName[];
      const unknown = args.filter((a) => !validSkills.includes(a as SkillName));

      if (unknown.length > 0) {
        setNotification(`Неизвестные skills: ${unknown.join(', ')}. Доступные: ${validSkills.join(', ')}`);
        return true;
      }

      setActiveSkills(requested);
      setNotification(`Skills активированы: ${requested.join(', ')}`);
      return true;
    }

    return false;
  }

  useInput(async (inputChar: string, key: Key) => {
    if (isLoading) return;

    if (key.return) {
      if (input.trim()) {
        const userInput = input.trim();
        setInput('');
        setNotification(null);

        if (handleSkillCommand(userInput)) return;

        setError(null);
        conversation.addUserMessage(userInput);
        setMessages(conversation.getHistory());
        setIsLoading(true);

        try {
          const systemPrompt = buildSystemPrompt(activeSkills);
          const response = await sendMessage(conversation.getHistory(), systemPrompt);
          conversation.addAssistantMessage(response);
          setMessages(conversation.getHistory());
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка';
          setError(errorMessage);
        } finally {
          setIsLoading(false);
        }
      }
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (!key.ctrl && !key.meta && inputChar) {
      setInput((prev) => prev + inputChar);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          CLI Агент (Ctrl+C для выхода)
        </Text>
        <Text dimColor>
          Модель: {process.env.OPENROUTER_MODEL || 'не указана'}
        </Text>
        <Text dimColor>
          Skills: {activeSkills.length > 0 ? activeSkills.join(', ') : 'нет'}{' '}
          <Text color="yellow">(/skill interview brief summarize | /skill off | /skills)</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {messages.map((msg, idx) => (
          <Box key={idx} marginBottom={1}>
            <Text bold color={msg.role === 'user' ? 'green' : 'blue'}>
              {msg.role === 'user' ? 'User' : 'Assistant'}:{' '}
            </Text>
            <Text>{msg.content}</Text>
          </Box>
        ))}
        {isLoading && (
          <Box>
            <Text bold color="blue">
              Assistant:{' '}
            </Text>
            <Text dimColor>[загрузка...]</Text>
          </Box>
        )}
      </Box>

      {notification && (
        <Box marginBottom={1}>
          <Text color="cyan">{notification}</Text>
        </Box>
      )}

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Ошибка: {error}</Text>
        </Box>
      )}

      <Box>
        <Text color="yellow">&gt; </Text>
        <Text>{input}</Text>
        <Text backgroundColor="white"> </Text>
      </Box>
    </Box>
  );
};
