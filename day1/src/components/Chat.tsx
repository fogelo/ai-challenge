import React, { useState } from 'react';
import { Box, Text, useInput, Key } from 'ink';
import { Conversation } from '../chat/conversation.js';
import { sendMessage } from '../api/openrouter.js';
import { Message } from '../types/index.js';

export const Chat: React.FC = () => {
  const [conversation] = useState(() => new Conversation());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput(async (inputChar: string, key: Key) => {
    if (isLoading) return;

    if (key.return) {
      if (input.trim()) {
        const userMessage = input.trim();
        setInput('');
        setError(null);

        conversation.addUserMessage(userMessage);
        setMessages(conversation.getHistory());
        setIsLoading(true);

        try {
          const response = await sendMessage(conversation.getHistory());
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
