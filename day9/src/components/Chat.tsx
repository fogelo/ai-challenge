import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, Key } from 'ink';
import { Conversation } from '../chat/conversation.js';
import { SessionManager } from '../chat/session.js';
import { sendMessage } from '../api/openrouter.js';
import { Message, UsageInfo, SessionStats, MessageMetadata } from '../types/index.js';
import { SKILLS, SkillName } from '../skills/index.js';
import { ModelRegistry } from '../models/registry.js';
import { ConfigManager } from '../models/config.js';
import { calculateApproximateTokens } from '../utils/tokens.js';

interface ChatProps {
  modelRegistry: ModelRegistry;
  configManager: ConfigManager;
}

function buildSystemPrompt(activeSkills: SkillName[]): string | undefined {
  if (activeSkills.length === 0) return undefined;
  return activeSkills.map((name) => SKILLS[name]).join('\n\n---\n\n');
}

function getContextWarning(
  totalPromptTokens: number,
  modelId: string,
  modelRegistry: ModelRegistry
): { level: 'none' | 'warning' | 'critical'; message: string } {
  const model = modelRegistry.getModel(modelId);
  const contextLength = model?.context_length;

  if (!contextLength || totalPromptTokens === 0) {
    return { level: 'none', message: '' };
  }

  const usagePercent = (totalPromptTokens / contextLength) * 100;
  const remaining = contextLength - totalPromptTokens;
  const remainingPercent = ((remaining / contextLength) * 100).toFixed(1);

  if (usagePercent >= 90) {
    return {
      level: 'critical',
      message: `⚠️  КРИТИЧНО: Контекст почти заполнен ${totalPromptTokens}/${contextLength} (${usagePercent.toFixed(1)}%). Осталось ${remainingPercent}%`,
    };
  }

  if (usagePercent >= 70) {
    return {
      level: 'warning',
      message: `⚡ Предупреждение: Контекст ${totalPromptTokens}/${contextLength} (${usagePercent.toFixed(1)}%). Осталось ${remainingPercent}%`,
    };
  }

  return {
    level: 'none',
    message: `Контекст: ${totalPromptTokens}/${contextLength} (${usagePercent.toFixed(1)}%). Осталось ${remainingPercent}%`,
  };
}

function checkContextThreshold(
  conversation: Conversation,
  currentModel: string,
  modelRegistry: ModelRegistry,
  threshold: number
): boolean {
  const messages = conversation.getHistory();
  const totalTokens = calculateApproximateTokens(messages);
  const model = modelRegistry.getModel(currentModel);
  const contextLength = model?.context_length;

  if (!contextLength || totalTokens === 0) {
    return false;
  }

  const percentage = totalTokens / contextLength;
  return percentage > threshold;
}

function calculateTokenSavings(
  originalMessages: Message[],
  summaryMessage: Message,
  recentMessages: Message[]
): { original: number; compressed: number; savings: number } {
  const original = calculateApproximateTokens(originalMessages);
  const compressed = calculateApproximateTokens([summaryMessage, ...recentMessages]);
  const savings = Math.round(((original - compressed) / original) * 100);

  return { original, compressed, savings };
}

export const Chat: React.FC<ChatProps> = ({ modelRegistry, configManager }) => {
  const [sessionManager] = useState(() => new SessionManager());
  const [conversation] = useState(() => new Conversation(sessionManager));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSkills, setActiveSkills] = useState<SkillName[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [temperature, setTemperature] = useState<number>(1.0);
  const [currentModel, setCurrentModel] = useState(configManager.getConfig().currentModel);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    requestCount: 0,
  });
  const [lastResponseMetrics, setLastResponseMetrics] = useState<{
    responseTime: number;
    usage?: UsageInfo;
  } | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);

  async function performSummarization(forced: boolean = false): Promise<void> {
    const config = configManager.getSummarizationConfig();
    const messages = conversation.getHistory();

    // Check if summarization is needed
    if (messages.length <= config.keepRecentMessages) {
      if (forced) {
        setNotification('ℹ️  Суммаризация не требуется (недостаточно сообщений)');
      }
      return;
    }

    setIsSummarizing(true);
    setNotification('⚡ Выполняется суммаризация контекста...');

    try {
      // Messages to summarize (all except recent)
      const toSummarize = messages.slice(0, -config.keepRecentMessages);
      const recentMessages = messages.slice(-config.keepRecentMessages);

      // Build summarization prompt
      const summaryPrompt = `Создай краткое резюме следующего диалога, сохраняя ключевые темы, решения и важный контекст. Формат: 2-3 абзаца на русском языке.`;

      const summaryMessages: Message[] = [
        { role: 'system', content: summaryPrompt },
        ...toSummarize,
      ];

      // Get summary from API
      const response = await sendMessage(summaryMessages, currentModel, undefined, temperature);

      // Update conversation state
      conversation.setSummary(response.content);
      conversation.setNeedsSummarization(false);

      // Calculate savings
      const savings = calculateTokenSavings(messages, { role: 'system', content: response.content }, recentMessages);

      // Show success notification
      if (forced) {
        setNotification(
          `✓ Готово! Сжато ${toSummarize.length} сообщений, сохранены последние ${config.keepRecentMessages}\n` +
          `💾 Токены: ${savings.original} → ~${savings.compressed} (экономия ${savings.savings}%)`
        );
      } else {
        setNotification(
          `✓ Контекст сжат: ${toSummarize.length} сообщений → summary + ${config.keepRecentMessages} последних`
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setNotification(`❌ Ошибка суммаризации: ${errorMsg}`);
      setError(`Summarization error: ${errorMsg}`);
    } finally {
      setIsSummarizing(false);
    }
  }

  function handleCommand(rawInput: string): boolean {
    const trimmed = rawInput.trim();

    // Temperature command
    if (trimmed.startsWith('/temperature ')) {
      const value = trimmed.slice('/temperature '.length).trim();
      const temp = parseFloat(value);

      if (isNaN(temp) || temp < 0 || temp > 2) {
        setNotification('Temperature должен быть числом от 0 до 2');
        return true;
      }

      setTemperature(temp);
      setNotification(`Temperature установлен на ${temp}`);
      return true;
    }

    if (trimmed === '/temperature') {
      setNotification(`Текущий temperature: ${temperature}`);
      return true;
    }

    // Skills commands
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

    // Model commands
    if (trimmed === '/model') {
      const config = configManager.getConfig();
      const favorites = config.favoriteModels;

      let output = 'Доступные модели:\n';
      favorites.forEach((modelId, index) => {
        const model = modelRegistry.getModel(modelId);
        const name = model ? model.name : modelId;
        const current = modelId === currentModel ? ' ← текущая' : '';
        output += `${index + 1}. ${name} (${modelId})${current}\n`;
      });

      output += '\nКоманды:\n';
      output += '/model <номер> - переключиться\n';
      output += '/model add <model-id> - добавить модель\n';
      output += '/model remove <номер> - удалить модель';

      setNotification(output);
      return true;
    }

    if (trimmed.startsWith('/model ') && !trimmed.startsWith('/model add') && !trimmed.startsWith('/model remove')) {
      const arg = trimmed.slice('/model '.length).trim();
      const num = parseInt(arg, 10);

      if (isNaN(num)) {
        setNotification('Используй номер модели, например: /model 3');
        return true;
      }

      const config = configManager.getConfig();
      const favorites = config.favoriteModels;

      if (num < 1 || num > favorites.length) {
        setNotification(`Номер должен быть от 1 до ${favorites.length}`);
        return true;
      }

      const modelId = favorites[num - 1];
      const model = modelRegistry.getModel(modelId);

      if (!model) {
        setNotification(`Модель ${modelId} не найдена в OpenRouter`);
        return true;
      }

      configManager.setCurrentModel(modelId);
      setCurrentModel(modelId);
      setNotification(`Модель переключена на: ${model.name} (${modelId})`);
      return true;
    }

    if (trimmed.startsWith('/model add ')) {
      const modelId = trimmed.slice('/model add '.length).trim();

      if (!modelId) {
        setNotification('Укажите ID модели, например: /model add anthropic/claude-3-opus');
        return true;
      }

      const model = modelRegistry.getModel(modelId);

      if (!model) {
        setNotification(`Модель ${modelId} не найдена в OpenRouter`);
        return true;
      }

      const added = configManager.addFavoriteModel(modelId);

      if (!added) {
        setNotification(`Модель ${model.name} уже в списке`);
        return true;
      }

      setNotification(`Модель ${model.name} (${modelId}) добавлена в список`);
      return true;
    }

    if (trimmed.startsWith('/model remove ')) {
      const arg = trimmed.slice('/model remove '.length).trim();
      const num = parseInt(arg, 10);

      if (isNaN(num)) {
        setNotification('Используй номер модели, например: /model remove 2');
        return true;
      }

      const config = configManager.getConfig();
      const favorites = config.favoriteModels;

      if (num < 1 || num > favorites.length) {
        setNotification(`Номер должен быть от 1 до ${favorites.length}`);
        return true;
      }

      const modelId = favorites[num - 1];
      const model = modelRegistry.getModel(modelId);
      const modelName = model ? model.name : modelId;

      const removed = configManager.removeFavoriteModel(num - 1);

      if (!removed) {
        setNotification('Не могу удалить последнюю модель из списка');
        return true;
      }

      setNotification(`Модель ${modelName} удалена из списка`);
      return true;
    }

    // Clear command
    if (trimmed === '/clear') {
      conversation.clear();
      setSessionStats({
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCost: 0,
        requestCount: 0,
      });
      setLastResponseMetrics(null);
      setError(null);
      setNotification('Контекст очищен. Создана новая сессия. Предыдущая сессия сохранена.');
      return true;
    }

    // Compact command
    if (trimmed === '/compact') {
      if (isLoading || isSummarizing) {
        setNotification('⏳ Дождитесь завершения текущей операции');
        return true;
      }

      const config = configManager.getSummarizationConfig();
      const messages = conversation.getHistory();

      if (messages.length <= config.keepRecentMessages) {
        const model = modelRegistry.getModel(currentModel);
        const contextLength = model?.context_length || 0;
        const totalTokens = calculateApproximateTokens(messages);
        const percentage = contextLength > 0 ? ((totalTokens / contextLength) * 100).toFixed(1) : '0.0';

        setNotification(`ℹ️  Суммаризация не требуется (контекст: ${percentage}%)`);
        return true;
      }

      performSummarization(true);
      return true;
    }

    // Resume command - list sessions
    if (trimmed === '/resume') {
      const sessions = conversation.listSessions();

      if (sessions.length === 0) {
        setNotification('Нет сохраненных сессий');
        return true;
      }

      let output = 'Сохраненные сессии:\n';
      sessions.forEach((session, index) => {
        const createdDate = new Date(session.createdAt).toLocaleString('ru-RU');
        const updatedDate = new Date(session.updatedAt).toLocaleString('ru-RU');
        output += `${index + 1}. ${session.fileName}\n`;
        output += `   ID: ${session.id}\n`;
        output += `   Создана: ${createdDate}\n`;
        output += `   Обновлена: ${updatedDate}\n`;
        output += `   Сообщений: ${session.messageCount}\n`;
      });
      output += '\nИспользуй /resume <номер> для загрузки';

      setNotification(output);
      return true;
    }

    // Resume command - load specific session
    if (trimmed.startsWith('/resume ')) {
      const arg = trimmed.slice('/resume '.length).trim();
      const num = parseInt(arg, 10);

      if (isNaN(num)) {
        setNotification('Используй номер сессии, например: /resume 1');
        return true;
      }

      const sessions = conversation.listSessions();

      if (num < 1 || num > sessions.length) {
        setNotification(`Номер должен быть от 1 до ${sessions.length}`);
        return true;
      }

      const targetSession = sessions[num - 1];
      const result = conversation.resumeSession(targetSession.id);

      if (!result.success) {
        setNotification(`Не удалось загрузить сессию ${targetSession.id}`);
        return true;
      }

      // Restore session state
      setMessages(conversation.getHistory());

      if (result.stats) {
        setSessionStats(result.stats);
      }

      setNotification(
        `Сессия загружена: ${targetSession.fileName}\n` +
        `Сообщений: ${targetSession.messageCount}\n` +
        `Создана: ${new Date(targetSession.createdAt).toLocaleString('ru-RU')}`
      );
      return true;
    }

    // Stats command
    if (trimmed === '/stats') {
      const history = conversation.getHistory();

      // Фильтруем только пары user-assistant
      const requests: Array<{
        userMsg: Message;
        assistantMsg: Message;
        requestNumber: number;
      }> = [];

      for (let i = 0; i < history.length - 1; i++) {
        if (history[i].role === 'user' && history[i + 1].role === 'assistant') {
          requests.push({
            userMsg: history[i],
            assistantMsg: history[i + 1],
            requestNumber: requests.length + 1,
          });
        }
      }

      if (requests.length === 0) {
        setNotification('Нет запросов для отображения');
        return true;
      }

      // Формируем вывод
      let output = 'История запросов:\n\n';

      requests.forEach(({ userMsg, assistantMsg, requestNumber }) => {
        const meta = assistantMsg.metadata;
        const preview = userMsg.content.slice(0, 50) + (userMsg.content.length > 50 ? '...' : '');

        output += `#${requestNumber}. "${preview}"\n`;

        if (meta) {
          output += `   Токены: ${meta.usage?.total_tokens ?? 'N/A'} `;
          output += `(prompt: ${meta.usage?.prompt_tokens ?? 'N/A'}, `;
          output += `completion: ${meta.usage?.completion_tokens ?? 'N/A'})\n`;
          output += `   Стоимость: ${meta.cost !== undefined ? `$${meta.cost.toFixed(6)}` : 'N/A'}\n`;
          output += `   Время: ${meta.responseTime?.toFixed(2) ?? 'N/A'}s\n`;
          output += `   Модель: ${meta.model ?? 'N/A'}\n`;
        } else {
          output += '   Метрики недоступны\n';
        }
        output += '\n';
      });

      // Итоговая статистика
      output += `Всего запросов: ${requests.length}\n`;
      output += `Всего токенов: ${sessionStats.totalTokens} `;
      output += `(prompt: ${sessionStats.totalPromptTokens}, `;
      output += `completion: ${sessionStats.totalCompletionTokens})\n`;
      output += `Общая стоимость: $${sessionStats.totalCost.toFixed(6)}`;

      setNotification(output);
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
        setLastResponseMetrics(null);

        if (handleCommand(userInput)) return;

        setError(null);
        conversation.addUserMessage(userInput);
        setMessages(conversation.getHistory());
        setIsLoading(true);

        try {
          // Check if summarization is needed before processing
          if (conversation.needsSummarization()) {
            await performSummarization(false);
          }

          const systemPrompt = buildSystemPrompt(activeSkills);
          const config = configManager.getSummarizationConfig();
          const apiMessages = conversation.getMessagesForAPI(config.keepRecentMessages);

          const apiResponse = await sendMessage(
            apiMessages,
            currentModel,
            systemPrompt,
            temperature
          );

          // Сохраняем метрики последнего ответа
          setLastResponseMetrics({
            responseTime: apiResponse.responseTime,
            usage: apiResponse.usage,
          });

          // Создаем metadata для сохранения
          const metadata: MessageMetadata = {
            usage: apiResponse.usage,
            responseTime: apiResponse.responseTime,
            cost: apiResponse.usage
              ? modelRegistry.calculateCost(currentModel, apiResponse.usage)
              : undefined,
            model: currentModel,
            timestamp: new Date().toISOString(),
          };

          // Обновляем статистику сессии (если есть usage)
          let newStats = sessionStats;
          if (apiResponse.usage) {
            const usage = apiResponse.usage;
            newStats = {
              totalTokens: sessionStats.totalTokens + usage.total_tokens,
              totalPromptTokens: sessionStats.totalPromptTokens + usage.prompt_tokens,
              totalCompletionTokens: sessionStats.totalCompletionTokens + usage.completion_tokens,
              totalCost: sessionStats.totalCost + modelRegistry.calculateCost(currentModel, usage),
              requestCount: sessionStats.requestCount + 1,
            };
            setSessionStats(newStats);
          }

          conversation.addAssistantMessage(apiResponse.content, metadata);
          setMessages(conversation.getHistory());

          // Check if summarization will be needed for next request
          const summaryConfig = configManager.getSummarizationConfig();
          if (checkContextThreshold(conversation, currentModel, modelRegistry, summaryConfig.threshold)) {
            conversation.setNeedsSummarization(true);
          }

          // Auto-save session after assistant response
          conversation.saveSession(newStats);
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

  // Handle graceful shutdown on Ctrl+C
  useEffect(() => {
    const handleExit = () => {
      try {
        // Save session before exit
        conversation.saveSession(sessionStats);
        console.log('\nСессия сохранена. До встречи!');
      } catch (error) {
        console.error('\nОшибка при сохранении:', error);
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', handleExit);

    return () => {
      process.off('SIGINT', handleExit);
    };
  }, [conversation, sessionStats]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          CLI Агент (Ctrl+C для выхода)
        </Text>
        <Text dimColor>
          Модель: {currentModel} | Temperature: {temperature}
        </Text>
        <Text dimColor>
          Skills: {activeSkills.length > 0 ? activeSkills.join(', ') : 'нет'}{' '}
          <Text color="yellow">(/skill interview brief summarize | /skill off | /skills)</Text>
        </Text>
        <Text dimColor>
          <Text color="yellow">/temperature [0-2]</Text> - установить temperature
        </Text>
        <Text dimColor>
          <Text color="yellow">/model</Text> - управление моделями | <Text color="yellow">/model add/remove</Text>
        </Text>
        <Text dimColor>
          <Text color="yellow">/clear</Text> - очистить контекст и статистику
        </Text>
        <Text dimColor>
          <Text color="yellow">/compact</Text> - выполнить суммаризацию контекста вручную
        </Text>
        <Text dimColor>
          <Text color="yellow">/resume</Text> - восстановить сохраненную сессию
        </Text>
        <Text dimColor>
          <Text color="yellow">/stats</Text> - показать историю запросов с метриками
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

      {lastResponseMetrics && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>
            ⏱ {lastResponseMetrics.responseTime.toFixed(2)}s | 📊{' '}
            {lastResponseMetrics.usage
              ? `${lastResponseMetrics.usage.total_tokens} tokens (prompt: ${lastResponseMetrics.usage.prompt_tokens}, completion: ${lastResponseMetrics.usage.completion_tokens})`
              : 'N/A tokens'
            } | 💰{' '}
            {lastResponseMetrics.usage
              ? `$${modelRegistry.calculateCost(currentModel, lastResponseMetrics.usage).toFixed(6)}`
              : 'N/A'
            }
          </Text>
          <Text dimColor>
            📈 Session total:{' '}
            {sessionStats.requestCount > 0 && sessionStats.totalTokens > 0
              ? `${sessionStats.totalTokens} tokens | $${sessionStats.totalCost.toFixed(6)}`
              : 'N/A tokens | N/A'
            }
          </Text>
        </Box>
      )}

      {sessionStats.totalPromptTokens > 0 && (() => {
        const contextWarning = getContextWarning(sessionStats.totalPromptTokens, currentModel, modelRegistry);
        const hasSummary = conversation.getSummary() !== null;
        const summaryIndicator = hasSummary ? ' [S]' : '';
        return (
          <Box marginBottom={1}>
            <Text
              color={
                contextWarning.level === 'critical'
                  ? 'red'
                  : contextWarning.level === 'warning'
                  ? 'yellow'
                  : 'gray'
              }
            >
              {contextWarning.message}{summaryIndicator}
            </Text>
          </Box>
        );
      })()}

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
