import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, Key } from 'ink';
import { Conversation } from '../chat/conversation.js';
import { SessionManager } from '../chat/session.js';
import { sendMessage } from '../api/openrouter.js';
import { Message, UsageInfo, SessionStats, MessageMetadata, Reminder } from '../types/index.js';
import { SKILLS, SkillName } from '../skills/index.js';
import { ModelRegistry } from '../models/registry.js';
import { ConfigManager } from '../models/config.js';
import { calculateApproximateTokens } from '../utils/tokens.js';
import {
  SlidingWindowStrategy,
  StickyFactsStrategy,
  BranchingStrategy,
} from '../strategies/index.js';
import { InterviewFlow } from '../profile/index.js';
import { STATE_INDICATORS, ALLOWED_TRANSITIONS, STATE_INSTRUCTIONS, TaskState } from '../taskstate/index.js';
import { InvariantManager } from '../invariants/index.js';
import { MCPClientManager, MCPTool } from '../mcp/index.js';
import { RagManager, ragQuery } from '../rag/index.js';
import type { RagAnswer } from '../rag/index.js';
import path from 'path';

interface ChatProps {
  modelRegistry: ModelRegistry;
  configManager: ConfigManager;
}

function buildSystemPrompt(
  activeSkills: SkillName[],
  invariants?: string | null
): string | undefined {
  const parts: string[] = [];

  if (activeSkills.length > 0) {
    parts.push(activeSkills.map((name) => SKILLS[name]).join('\n\n---\n\n'));
  }

  if (invariants) {
    parts.push('\n\n' + invariants);
  }

  return parts.length > 0 ? parts.join('') : undefined;
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

function getTaskStateDisplay(conversation: Conversation): string {
  const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
  const task = taskMachine.getCurrentTask();

  if (!task) return '';

  const indicator = STATE_INDICATORS[task.currentState];
  return `[State: ${task.currentState.toUpperCase()}] ${indicator}`;
}

async function handleInvariantsCommand(
  args: string[],
  invariantManager: InvariantManager,
  setNotification: (msg: string) => void,
  currentModel: string
): Promise<void> {
  const command = args[0];

  if (!command) {
    // Показать все инварианты
    const invariants = invariantManager.getInvariants();
    if (!invariants || Object.keys(invariants.invariants).length === 0) {
      setNotification('Инварианты не заданы. Агент работает без ограничений.');
      return;
    }

    let output = 'Активные инварианты:\n\n';
    for (const [category, data] of Object.entries(invariants.invariants)) {
      const priority = data.type === 'hard' ? 'КРИТИЧНО' : 'РЕКОМЕНДАЦИЯ';
      output += `[${category}] ${priority}\n`;
      output += `${data.description}\n`;
      data.rules.forEach((rule) => {
        output += `- ${rule}\n`;
      });
      output += '\n';
    }
    setNotification(output);
    return;
  }

  if (command === 'reload') {
    try {
      await invariantManager.reload();
      setNotification('✅ Инварианты перезагружены из файла');
    } catch (error) {
      setNotification(
        `❌ Ошибка перезагрузки: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    return;
  }

  if (command === 'test') {
    const testText = args.slice(1).join(' ');
    if (!testText) {
      setNotification('Использование: /invariants test <текст для проверки>');
      return;
    }

    try {
      const validation = await invariantManager.validate(
        testText,
        currentModel
      );

      if (validation.valid) {
        setNotification('✅ Нарушений не найдено');
      } else {
        const message = invariantManager.formatViolationMessage(validation);
        setNotification(message);
      }
    } catch (error) {
      setNotification(
        `❌ Ошибка валидации: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    return;
  }

  setNotification(
    'Доступные команды:\n' +
      '/invariants - показать все инварианты\n' +
      '/invariants reload - перезагрузить из файла\n' +
      '/invariants test <текст> - протестировать текст на нарушения'
  );
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
  const [interviewMode, setInterviewMode] = useState(false);
  const [interviewStep, setInterviewStep] = useState(0);
  const [interviewAnswers, setInterviewAnswers] = useState<Record<string, any>>({});
  const [ragMode, setRagMode] = useState(false);
  const [invariantManager] = useState(() => new InvariantManager('.invariants'));
  const [invariantsLoaded, setInvariantsLoaded] = useState(false);
  const [mcpManager] = useState(() => new MCPClientManager());
  const [ragManager] = useState(() => new RagManager({
    sourcePath: path.resolve('for_rag/Архитектура'),
    outputPath: path.resolve('rag-data'),
    embeddingModel: 'nomic-embed-text',
    ollamaUrl: 'http://localhost:11434',
    topK: 3,
    chunkSize: 500,
    chunkOverlap: 100,
  }));
  const [activeMcpTool, setActiveMcpTool] = useState<string | null>(null);
  interface ToolCallLog {
    serverName: string;
    toolName: string;
    result: string;
  }
  const [toolCallLogs, setToolCallLogs] = useState<ToolCallLog[]>([]);
  const isPollingRef = useRef(false);
  const [isMcpConnected, setIsMcpConnected] = useState(false);

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

  // Function to automatically send a message to the agent
  async function sendAutoMessage(message: string) {
    setError(null);
    await conversation.addUserMessage(message);
    setMessages(conversation.getHistory());
    setIsLoading(true);

    try {
      // Check if summarization is needed before processing
      if (conversation.needsSummarization()) {
        await performSummarization(false);
      }

      // Build system prompt with memory context and invariants
      const formattedInvariants = invariantManager.getFormattedInvariants();
      const basePrompt = buildSystemPrompt(activeSkills, formattedInvariants);
      const systemPrompt = conversation.buildSystemPromptWithMemory(basePrompt);
      const apiMessages = await conversation.getMessagesForAPI();

      const apiResponse = await sendMessage(
        apiMessages,
        currentModel,
        systemPrompt,
        temperature
      );

      // Валидация ответа на соответствие инвариантам
      if (invariantsLoaded) {
        const validation = await invariantManager.validate(
          apiResponse.content,
          currentModel
        );

        if (!validation.valid) {
          // Показываем ошибку вместо ответа
          const errorMessage = invariantManager.formatViolationMessage(validation);
          const errorMetadata: MessageMetadata = {
            timestamp: new Date().toISOString(),
            model: currentModel,
          };
          await conversation.addAssistantMessage(errorMessage, errorMetadata);
          setMessages(conversation.getHistory());
          return;
        }
      }

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

      await conversation.addAssistantMessage(apiResponse.content, metadata);
      setMessages(conversation.getHistory());

      // Save to short-term memory
      await conversation.getMemoryManager().getShortTerm().save();

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

  async function handleCommand(rawInput: string): Promise<boolean> {
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
      setToolCallLogs([]);
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

    // Strategy command
    if (trimmed === '/strategy') {
      let output = 'Доступные стратегии:\n';
      output += '1. Sliding Window - последние N сообщений\n';
      output += '2. Sticky Facts - ключевые факты + недавние сообщения\n';
      output += '3. Branching - ветки разговора\n\n';
      output += `Текущая: ${conversation.getStrategyName()}\n\n`;
      output += 'Использование: /strategy <номер>';
      setNotification(output);
      return true;
    }

    if (trimmed.startsWith('/strategy ')) {
      const num = parseInt(trimmed.split(' ')[1]);
      await switchStrategy(num);
      return true;
    }

    // Checkpoint command (for Branching)
    if (trimmed === '/checkpoint') {
      const strategy = conversation.getStrategy();
      if (strategy instanceof BranchingStrategy) {
        try {
          const checkpointId = strategy.createCheckpoint();
          setNotification(`✓ Чекпойнт создан (ID: ${checkpointId.slice(0, 8)}...)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          setNotification(`⚠ ${errorMessage}`);
        }
      } else {
        setNotification('⚠ Чекпойнты доступны только в стратегии Branching');
      }
      return true;
    }

    // Branch command
    if (trimmed.startsWith('/branch')) {
      const strategy = conversation.getStrategy();

      if (!(strategy instanceof BranchingStrategy)) {
        setNotification('⚠ Ветки доступны только в стратегии Branching');
        return true;
      }

      const parts = trimmed.split(' ');

      if (parts.length === 1 || parts[1] === 'list') {
        // List branches
        const branches = strategy.listBranches();
        const checkpoints = strategy.listCheckpoints();

        let output = `\nЧекпойнты: ${checkpoints.length}\n`;
        checkpoints.forEach((cp, i) => {
          output += `  ${i + 1}. ${cp.name || 'Без имени'} - ${cp.messageIndex} сообщений - ${new Date(cp.timestamp).toLocaleString()}\n`;
        });
        output += `\nВетки: ${branches.length}\n`;
        branches.forEach((b, i) => {
          output += `  ${i + 1}. ${b.name} - ${b.messageCount} сообщений ${b.isCurrent ? '(активна)' : ''}\n`;
        });
        setNotification(output);
      } else if (parts[1] === 'new') {
        // Create new branch
        const name = parts.slice(2).join(' ') || 'Без имени';
        try {
          const branchId = strategy.createBranch(name);
          setNotification(`✓ Ветка "${name}" создана и активирована`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          setNotification(`⚠ ${errorMessage}`);
        }
      } else if (parts[1] === 'main') {
        // Switch to main
        strategy.switchToMain();
        setNotification('✓ Переключено на главную ветку');
      } else {
        // Switch to branch by number
        const branchIndex = parseInt(parts[1]) - 1;
        const branches = strategy.listBranches();

        if (branchIndex >= 0 && branchIndex < branches.length) {
          try {
            strategy.switchBranch(branches[branchIndex].id);
            setNotification(`✓ Переключено на ветку: ${branches[branchIndex].name}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            setNotification(`⚠ ${errorMessage}`);
          }
        } else {
          setNotification('⚠ Неверный номер ветки');
        }
      }

      return true;
    }

    // Facts command (for Sticky Facts)
    if (trimmed === '/facts') {
      const strategy = conversation.getStrategy();

      if (strategy instanceof StickyFactsStrategy) {
        const facts = strategy.getFacts();
        const factCount = Object.keys(facts).length;

        if (factCount === 0) {
          setNotification('Факты ещё не извлечены');
        } else {
          const output = `\nИзвлечённые факты (${factCount}):\n${JSON.stringify(facts, null, 2)}`;
          setNotification(output);
        }
      } else {
        setNotification('⚠ Факты доступны только в стратегии Sticky Facts');
      }
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

        // Show task state if available
        let taskInfo = '';
        if (session.taskState && session.taskDescription) {
          const indicator = STATE_INDICATORS[session.taskState as TaskState];
          taskInfo = ` [${session.taskState.toUpperCase()} ${indicator}]`;
        }

        output += `${index + 1}. ${session.fileName}${taskInfo}\n`;
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

    // Task commands
    if (trimmed.startsWith('/task')) {
      const args = trimmed.slice(6).trim();

      // /task (show current task)
      if (!args) {
        const task = conversation.getMemoryManager().getTaskStateMachine().getCurrentTask();
        if (!task) {
          setNotification('📋 Нет активной задачи. Начните новую задачу, отправив сообщение.');
        } else {
          const indicator = STATE_INDICATORS[task.currentState];
          const history = task.stateHistory.map(t => `${t.from} → ${t.to}`).join(' → ');
          const created = new Date(task.startedAt).toLocaleString('ru-RU');

          setNotification(
            `📋 Текущая задача:\n` +
            `Описание: ${task.description}\n` +
            `Состояние: ${task.currentState.toUpperCase()} ${indicator}\n` +
            `Создана: ${created}\n` +
            `История: ${history}`
          );
        }
        return true;
      }

      // /task new <description>
      if (args.startsWith('new ')) {
        const description = args.slice(4).trim();
        if (!description) {
          setNotification('❌ Укажите описание задачи: /task new <описание>');
          return true;
        }

        const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
        const task = taskMachine.createTask(description);

        setNotification(
          `✅ Создана новая задача [ID: ${task.taskId}]\n` +
          `Описание: ${description}\n` +
          `Состояние: PLANNING 🟡`
        );
        return true;
      }

      // /task list
      if (args === 'list') {
        const tasks = conversation.getMemoryManager().getTaskStateMachine().listTasks();

        if (tasks.length === 0) {
          setNotification('📋 Нет сохраненных задач.');
        } else {
          const taskList = tasks.map((t, idx) => {
            const indicator = STATE_INDICATORS[t.state];
            const updated = new Date(t.updatedAt).toLocaleString('ru-RU');
            return `${idx + 1}. ${t.description.slice(0, 50)}${t.description.length > 50 ? '...' : ''} [${t.state.toUpperCase()} ${indicator}] - ${updated}`;
          }).join('\n');

          setNotification(`📋 Задачи:\n${taskList}`);
        }
        return true;
      }

      // /task load <number>
      if (args.startsWith('load ')) {
        const numStr = args.slice(5).trim();
        const num = parseInt(numStr, 10);

        if (isNaN(num) || num < 1) {
          setNotification('❌ Укажите номер задачи: /task load <номер>');
          return true;
        }

        const tasks = conversation.getMemoryManager().getTaskStateMachine().listTasks();
        if (num > tasks.length) {
          setNotification(`❌ Задача #${num} не найдена. Всего задач: ${tasks.length}`);
          return true;
        }

        const task = tasks[num - 1];
        const loaded = conversation.getMemoryManager().getTaskStateMachine().load(task.taskId);

        if (loaded) {
          const indicator = STATE_INDICATORS[task.state];
          setNotification(
            `✅ Загружена задача: ${task.description}\n` +
            `Состояние: ${task.state.toUpperCase()} ${indicator}\n` +
            `Продолжаем работу...`
          );
        } else {
          setNotification('❌ Не удалось загрузить задачу');
        }
        return true;
      }
    }

    // Next command - manual state transition
    if (trimmed === '/next') {
      const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
      const task = taskMachine.getCurrentTask();

      if (!task) {
        setNotification('❌ Нет активной задачи');
        return true;
      }

      const currentState = task.currentState;
      const allowedStates = ALLOWED_TRANSITIONS[currentState];

      if (allowedStates.length === 0) {
        setNotification('✅ Задача уже в финальном состоянии DONE 🟢');
        return true;
      }

      // Transition to first allowed state
      const nextState = allowedStates[0];
      const success = taskMachine.transition(nextState, 'Manual transition via /next');

      if (success) {
        const indicator = STATE_INDICATORS[nextState];
        setNotification(
          `✅ Переход: ${currentState.toUpperCase()} → ${nextState.toUpperCase()} ${indicator}`
        );

        // Automatically trigger agent to start working on the new stage
        const transitionMessage = `Переходим к этапу ${nextState.toUpperCase()}. ${STATE_INSTRUCTIONS[nextState]}`;
        await sendAutoMessage(transitionMessage);
      } else {
        setNotification('❌ Не удалось выполнить переход');
      }

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

    // Constraint command
    if (trimmed.startsWith('/constraint')) {
      const parts = trimmed.split(' ').filter(Boolean);

      if (parts.length < 2) {
        setNotification('Использование: /constraint add <тип> <значение> | /constraint remove <тип> <значение> | /constraint list');
        return true;
      }

      const subcommand = parts[1];
      const memoryManager = conversation.getMemoryManager();

      if (subcommand === 'add') {
        if (parts.length < 4) {
          setNotification('Использование: /constraint add <forbidden|required|rules> <значение>');
          return true;
        }

        const type = parts[2] as 'forbidden' | 'required' | 'rules';
        const value = parts.slice(3).join(' ');

        if (!['forbidden', 'required', 'rules'].includes(type)) {
          setNotification('Тип должен быть: forbidden, required, или rules');
          return true;
        }

        await memoryManager.getLongTerm().addConstraint(type, value);
        setNotification(`✓ Ограничение добавлено: ${type} = ${value}`);
      } else if (subcommand === 'remove') {
        if (parts.length < 4) {
          setNotification('Использование: /constraint remove <тип> <значение>');
          return true;
        }

        const type = parts[2] as 'forbidden' | 'required' | 'rules';
        const value = parts.slice(3).join(' ');

        await memoryManager.getLongTerm().removeConstraint(type, value);
        setNotification(`✓ Ограничение удалено: ${type} = ${value}`);
      } else if (subcommand === 'list') {
        const constraints = memoryManager.getLongTerm().getConstraints();
        let output = '\n🚫 ОГРАНИЧЕНИЯ:\n\n';
        output += `Запрещено: ${constraints.forbidden.join(', ') || 'нет'}\n`;
        output += `Требуется: ${constraints.required.join(', ') || 'нет'}\n`;
        output += `Правила:\n`;
        constraints.rules.forEach(rule => {
          output += `  - ${rule}\n`;
        });
        setNotification(output);
      } else {
        setNotification('Неизвестная подкоманда. Используйте: add, remove, list');
      }

      return true;
    }

    // Remember command
    if (trimmed.startsWith('/remember ')) {
      const content = trimmed.substring(10).trim(); // Remove "/remember "

      if (!content) {
        setNotification('Использование: /remember <что запомнить>');
        return true;
      }

      const fact = {
        id: `fact-${Date.now()}`,
        content,
        addedAt: new Date().toISOString(),
        relevance: 'high' as const,
      };

      await conversation.getMemoryManager().getLongTerm().addKnowledge(fact);
      setNotification(`✓ Сохранено в долговременную память: "${content}"`);
      return true;
    }

    // Memory command
    if (trimmed.startsWith('/memory')) {
      const parts = trimmed.split(' ').filter(Boolean);

      if (parts.length === 1) {
        // Show all memory
        const context = conversation.getMemoryManager().getContextForPrompt();

        let output = '\n=== ПАМЯТЬ АГЕНТА ===\n\n';

        output += '📝 КРАТКОСРОЧНАЯ ПАМЯТЬ (Short-term):\n';
        output += `  Сообщений: ${context.shortTerm.length}\n\n`;

        output += '🎯 РАБОЧАЯ ПАМЯТЬ (Working):\n';
        if (context.working) {
          output += `  Задача: ${context.working.description}\n`;
          output += `  Статус: ${context.working.status}\n`;
        } else {
          output += '  Нет активной задачи\n';
        }
        output += '\n';

        output += '💾 ДОЛГОВРЕМЕННАЯ ПАМЯТЬ (Long-term):\n';
        output += `  Профиль:\n`;
        output += `    Стек: ${context.longTerm.profile.preferences.stack.join(', ') || 'не задан'}\n`;
        output += `    Тон: ${context.longTerm.profile.style.tone}\n`;
        output += `  Ограничения:\n`;
        output += `    Запрещено: ${context.longTerm.constraints.forbidden.join(', ') || 'нет'}\n`;
        output += `    Требуется: ${context.longTerm.constraints.required.join(', ') || 'нет'}\n`;
        output += `  Знания: ${context.longTerm.knowledge.length} фактов\n`;

        setNotification(output);
        return true;
      }

      const subcommand = parts[1];

      if (subcommand === 'short' || subcommand === 'working' || subcommand === 'long') {
        const context = conversation.getMemoryManager().getContextForPrompt();
        let output = '';

        if (subcommand === 'short') {
          output = '\n📝 КРАТКОСРОЧНАЯ ПАМЯТЬ:\n\n';
          context.shortTerm.forEach((msg, i) => {
            output += `[${i + 1}] ${msg.role}: ${msg.content.substring(0, 60)}...\n`;
          });
        } else if (subcommand === 'working') {
          output = '\n🎯 РАБОЧАЯ ПАМЯТЬ:\n\n';
          if (context.working) {
            output += `Задача: ${context.working.description}\n`;
            output += `Статус: ${context.working.status}\n`;
            output += `Контекст: ${JSON.stringify(context.working.context, null, 2)}\n`;
          } else {
            output += 'Нет активной задачи\n';
          }
        } else if (subcommand === 'long') {
          output = '\n💾 ДОЛГОВРЕМЕННАЯ ПАМЯТЬ:\n\n';
          output += 'Профиль:\n';
          output += JSON.stringify(context.longTerm.profile, null, 2) + '\n\n';
          output += 'Ограничения:\n';
          output += JSON.stringify(context.longTerm.constraints, null, 2) + '\n\n';
          output += `Знания (${context.longTerm.knowledge.length} фактов):\n`;
          context.longTerm.knowledge.forEach(fact => {
            output += `- [${fact.relevance}] ${fact.content}\n`;
          });
        }

        setNotification(output);
        return true;
      }

      if (parts[1] === 'clear' && parts[2]) {
        const layer = parts[2] as 'short' | 'working' | 'long';
        await conversation.getMemoryManager().clear(layer);
        setNotification(`✓ Слой памяти "${layer}" очищен`);
        return true;
      }

      setNotification('Использование: /memory [short|working|long] или /memory clear <слой>');
      return true;
    }

    // Profile commands
    if (trimmed.startsWith('/profile')) {
      const parts = trimmed.split(' ').filter(Boolean);

      if (parts.length === 1 || parts[1] === 'show') {
        const profile = conversation.getMemoryManager().getProfileManager().getActiveProfile();

        if (!profile) {
          setNotification('❌ Нет активного профиля');
          return true;
        }

        let output = '\n👤 АКТИВНЫЙ ПРОФИЛЬ:\n\n';
        output += `Имя: ${profile.name}\n`;
        output += `Стиль: ${profile.responseStyle}\n`;
        output += `Тон: ${profile.tone}\n`;
        output += `Примеры кода: ${profile.includeCodeExamples ? 'да' : 'нет'}\n`;
        output += `Детализация: ${profile.detailLevel}\n`;
        output += `Контекст: ${profile.context.purpose}\n`;

        if (profile.stack.length > 0) {
          output += `Стек: ${profile.stack.join(', ')}\n`;
        }

        if (profile.preferredLanguage) {
          output += `Язык: ${profile.preferredLanguage}\n`;
        }

        setNotification(output);
        return true;
      }

      if (parts[1] === 'list') {
        const profiles = await conversation.getMemoryManager().getProfileManager().listProfiles();
        const activeProfile = conversation.getMemoryManager().getProfileManager().getActiveProfile();

        if (profiles.length === 0) {
          setNotification('Нет созданных профилей');
          return true;
        }

        let output = '\n📋 ПРОФИЛИ:\n\n';
        profiles.forEach((meta, index) => {
          const active = meta.name === activeProfile?.name ? ' ← активный' : '';
          output += `${index + 1}. ${meta.name}${active}\n`;
          output += `   Создан: ${new Date(meta.createdAt).toLocaleString('ru-RU')}\n`;
        });

        setNotification(output);
        return true;
      }

      if (parts[1] === 'switch') {
        if (parts.length < 3) {
          setNotification('Использование: /profile switch <имя>');
          return true;
        }

        const name = parts.slice(2).join(' ');
        const success = await conversation.getMemoryManager().switchProfile(name);

        if (success) {
          setNotification(`✓ Профиль переключен на "${name}"`);
        } else {
          setNotification(`❌ Профиль "${name}" не найден`);
        }

        return true;
      }

      if (parts[1] === 'delete') {
        if (parts.length < 3) {
          setNotification('Использование: /profile delete <имя>');
          return true;
        }

        const name = parts.slice(2).join(' ');
        const success = await conversation.getMemoryManager().getProfileManager().deleteProfile(name);

        if (success) {
          setNotification(`✓ Профиль "${name}" удален`);
        } else {
          setNotification('❌ Не удалось удалить профиль (активный или последний)');
        }

        return true;
      }

      if (parts[1] === 'create') {
        setNotification('🎤 Начинаем интервью для создания профиля...\n(Введите "skip" для пропуска вопроса, если доступно)');
        setInterviewMode(true);
        setInterviewStep(0);
        setInterviewAnswers({});
        return true;
      }

      setNotification('Команды: /profile show | list | switch <имя> | delete <имя> | create');
      return true;
    }

    // RAG commands
    if (trimmed.startsWith('/rag')) {
      const args = trimmed.slice(4).trim();

      if (args === 'mode on') {
        setRagMode(true);
        setNotification('🔍 RAG-режим включён. Все ответы будут дополнены источниками из базы знаний.');
        return true;
      }

      if (args === 'mode off') {
        setRagMode(false);
        setNotification('💬 RAG-режим выключен. Агент отвечает из общих знаний.');
        return true;
      }

      if (args === 'index' || args === '') {
        if (args === 'index') {
          setNotification('⏳ Индексирую документы... (это займёт несколько минут)');
          try {
            await ragManager.index();
            setNotification('✅ Индекс построен. Используй /rag <запрос> для поиска.');
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setNotification(`❌ ${msg}`);
          }
          return true;
        }
        setNotification(
          'RAG команды:\n' +
          '  /rag mode on           — включить RAG-режим для всего чата\n' +
          '  /rag mode off          — выключить RAG-режим\n' +
          '  /rag test              — запустить 10 контрольных вопросов\n' +
          '  /rag index             — индексировать документы\n' +
          '  /rag <запрос>          — поиск (structural)\n' +
          '  /rag <запрос> --fixed  — поиск (fixed)\n' +
          '  /rag compare <запрос>  — сравнить стратегии'
        );
        return true;
      }

      if (args.startsWith('compare ')) {
        const query = args.slice(8).trim();
        if (!query) {
          setNotification('Использование: /rag compare <запрос>');
          return true;
        }
        try {
          const { fixed, structural } = await ragManager.compare(query);
          const fmt = (results: typeof fixed) =>
            results.map((r, i) =>
              `${i + 1}. [${r.score.toFixed(2)}] ${r.chunk.title} / ${r.chunk.file}\n   ${r.chunk.text.slice(0, 150).replace(/\n/g, ' ')}...`
            ).join('\n\n');

          setNotification(
            `🔍 Сравнение стратегий: "${query}"\n\n` +
            `── STRUCTURAL ──────────────────────\n${fmt(structural)}\n\n` +
            `── FIXED ───────────────────────────\n${fmt(fixed)}`
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          setNotification(`❌ ${msg}`);
        }
        return true;
      }

      // /rag <query> [--fixed]
      const useFixed = args.endsWith('--fixed');
      const query = useFixed ? args.slice(0, -7).trim() : args;
      const strategy = useFixed ? 'fixed' : 'structural';

      if (!query) {
        setNotification('Использование: /rag <запрос>');
        return true;
      }

      try {
        const results = await ragManager.search(query, strategy);
        const output = results
          .map((r, i) =>
            `${i + 1}. [${r.score.toFixed(2)}] ${r.chunk.title} / ${r.chunk.file}\n` +
            (r.chunk.section ? `   section: "${r.chunk.section}"\n` : '') +
            `   "${r.chunk.text.slice(0, 200).replace(/\n/g, ' ')}..."`
          )
          .join('\n\n');

        setNotification(`🔍 RAG поиск (${strategy}): "${query}"\n\n${output}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setNotification(`❌ ${msg}`);
      }
      return true;
    }

    // Invariants commands
    if (trimmed.startsWith('/invariants')) {
      const args = trimmed.split(' ').slice(1);
      await handleInvariantsCommand(args, invariantManager, setNotification, currentModel);
      return true;
    }

    // Help command
    if (trimmed === '/help') {
      const helpText = `
📚 Доступные команды:

🤖 Модели:
  /model                    - список моделей
  /model <номер>            - переключиться на модель
  /model add <model-id>     - добавить модель в избранное
  /model remove <номер>     - удалить модель из избранного

💬 Контекст:
  /clear                    - очистить контекст и статистику
  /compact                  - сжать контекст вручную
  /stats                    - показать историю запросов
  /temperature [0-2]        - установить/показать temperature

📋 Задачи:
  /task                     - показать текущую задачу
  /task new <описание>      - создать новую задачу
  /task list                - список всех задач
  /task load <номер>        - загрузить задачу
  /next                     - перейти к следующему этапу

💾 Сессии:
  /resume                   - список сохраненных сессий
  /resume <номер>           - загрузить сессию

👤 Профили:
  /profile show             - показать активный профиль
  /profile list             - список всех профилей
  /profile create           - создать новый профиль
  /profile switch <имя>     - переключить профиль
  /profile delete <имя>     - удалить профиль

🔒 Инварианты:
  /invariants               - показать все активные инварианты
  /invariants reload        - перезагрузить из файла
  /invariants test <текст>  - протестировать текст на нарушения

🎯 Skills:
  /skills                   - показать активные skills
  /skill <name1> <name2>    - активировать skills
  /skill off                - отключить все skills

📊 Стратегии:
  /strategy                 - показать текущую стратегию
  /strategy <номер>         - переключить стратегию

📡 MCP:
  /mcp                           - подключиться и показать инструменты
  /mcp disconnect                - отключиться от сервера
  /mcp call <инструмент>         - вызвать инструмент вручную
  /mcp call <инструмент> <json>  - вызвать инструмент с параметрами

🔍 RAG:
  /rag mode on/off       — включить/выключить RAG-режим
  /rag test              — запустить 10 контрольных вопросов
  /rag index             — индексировать документы
  /rag <запрос>          — поиск по базе знаний
  /rag <запрос> --fixed  — поиск (fixed стратегия)
  /rag compare <запрос>  — сравнить две стратегии

📅 Напоминания:
  /remind                        - список всех напоминаний
  /remind <минуты> <текст>       - создать напоминание
  /remind cancel <id>            - отменить напоминание
      `.trim();

      setNotification(helpText);
      return true;
    }

    // ─── /remind ──────────────────────────────────────────────────────────
    if (trimmed === '/remind') {
      if (!mcpManager.isConnected()) {
        setNotification('❌ MCP не подключён. Сначала выполните /mcp');
        return true;
      }
      try {
        const result = await mcpManager.callTool('list_reminders', {});
        setNotification(result);
      } catch (err) {
        setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }

    if (trimmed === '/remind cancel') {
      setNotification('Использование: /remind cancel <id>');
      return true;
    }

    if (trimmed.startsWith('/remind cancel ')) {
      const id = trimmed.slice('/remind cancel '.length).trim();
      if (!id) {
        setNotification('Использование: /remind cancel <id>');
        return true;
      }
      if (!mcpManager.isConnected()) {
        setNotification('❌ MCP не подключён. Сначала выполните /mcp');
        return true;
      }
      try {
        const result = await mcpManager.callTool('cancel_reminder', { id });
        setNotification(result);
      } catch (err) {
        setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }

    if (trimmed.startsWith('/remind ')) {
      const args = trimmed.slice('/remind '.length).trim();
      const firstSpace = args.indexOf(' ');
      if (firstSpace === -1) {
        setNotification('Использование: /remind <минуты> <текст>\nПример: /remind 5 выпить воду');
        return true;
      }
      const minutesStr = args.slice(0, firstSpace);
      const text = args.slice(firstSpace + 1).trim();
      const minutes = parseInt(minutesStr, 10);

      if (isNaN(minutes)) {
        setNotification('Ошибка: укажите количество минут числом');
        return true;
      }
      if (minutes <= 0) {
        setNotification('Ошибка: минуты должны быть больше 0');
        return true;
      }
      if (!text) {
        setNotification('Ошибка: текст напоминания не может быть пустым');
        return true;
      }
      if (!mcpManager.isConnected()) {
        setNotification('❌ MCP не подключён. Сначала выполните /mcp');
        return true;
      }
      try {
        const result = await mcpManager.callTool('create_reminder', { text, minutes });
        setNotification(result);
      } catch (err) {
        setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }

    // MCP commands
    if (trimmed === '/mcp' || trimmed === '/mcp connect') {
      setNotification('⏳ Подключение к MCP серверам...');
      try {
        await mcpManager.connect();
        const tools = await mcpManager.listTools();

        // Группировать инструменты по серверам
        const byServer = new Map<string, MCPTool[]>();
        for (const tool of tools) {
          const list = byServer.get(tool.serverName) ?? [];
          list.push(tool);
          byServer.set(tool.serverName, list);
        }

        let output = `✅ MCP серверы подключены (${byServer.size})\n\n`;
        for (const [serverName, serverTools] of byServer) {
          output += `📡 ${serverName} (${serverTools.length}):\n`;
          for (const tool of serverTools) {
            output += `  🔧 ${tool.name}\n`;
            if (tool.description) output += `     ${tool.description.slice(0, 60)}\n`;
          }
          output += '\n';
        }

        setIsMcpConnected(true);
        setNotification(output);
      } catch (err) {
        setNotification(`❌ Ошибка подключения: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }

    if (trimmed === '/mcp disconnect') {
      await mcpManager.disconnect();
      setIsMcpConnected(false);
      setNotification('🔌 MCP отключён');
      return true;
    }

    if (trimmed.startsWith('/mcp call')) {
      const rest = trimmed.slice('/mcp call'.length).trim();
      if (!rest) {
        setNotification(
          'Использование: /mcp call <инструмент> [json-аргументы]\n' +
          'Пример: /mcp call get_time\n' +
          'Пример: /mcp call echo {"message":"привет"}'
        );
        return true;
      }

      // Парсинг: первый токен = имя инструмента, остаток = опциональные JSON-аргументы
      const spaceIdx = rest.indexOf(' ');
      const toolName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const argsStr = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

      let args: Record<string, unknown> = {};
      if (argsStr) {
        try {
          args = JSON.parse(argsStr) as Record<string, unknown>;
        } catch {
          setNotification(`❌ Неверный JSON: ${argsStr}`);
          return true;
        }
      }

      try {
        if (!mcpManager.isConnected()) {
          setNotification('⏳ Подключение к MCP серверу...');
          await mcpManager.connect();
        }

        setNotification(`⏳ Вызов инструмента: ${toolName}...`);
        const result = await mcpManager.callTool(toolName, args);
        setNotification(`🔧 ${toolName}:\n\n${result}`);
      } catch (err) {
        setNotification(
          `❌ Ошибка вызова инструмента: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return true;
    }

    return false;
  }

  const switchStrategy = async (num: number) => {
    try {
      const strategyConfig = configManager.getStrategyConfig();
      let newStrategy;

      switch (num) {
        case 1:
          newStrategy = new SlidingWindowStrategy(strategyConfig.slidingWindow.size);
          break;
        case 2:
          newStrategy = new StickyFactsStrategy(
            strategyConfig.stickyFacts.windowSize,
            strategyConfig.stickyFacts.extractionModel || null
          );
          break;
        case 3:
          newStrategy = new BranchingStrategy(strategyConfig.branching.maxCheckpoints);
          break;
        default:
          setNotification('⚠ Неверный номер стратегии. Используйте 1, 2 или 3.');
          return;
      }

      setNotification(`Переключение на ${newStrategy.getName()}...`);

      conversation.setStrategy(newStrategy);

      setNotification(`✓ Переключено на ${newStrategy.getName()}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setNotification(`⚠ Не удалось переключить стратегию: ${errorMessage}`);
    }
  };

  useInput(async (inputChar: string, key: Key) => {
    if (isLoading) return;

    if (key.return) {
      if (input.trim()) {
        const userInput = input.trim();
        setInput('');
        setNotification(null);
        setLastResponseMetrics(null);

        // Handle interview mode
        if (interviewMode) {
          const interviewFlow = new InterviewFlow();
          const questions = interviewFlow.getQuestions();
          const currentQuestion = questions[interviewStep];

          // Handle skip on first question - create default profile
          if (interviewStep === 0 && userInput.toLowerCase() === 'skip') {
            const profileManager = conversation.getMemoryManager().getProfileManager();
            const defaultProfile = profileManager.createDefaultProfile();
            await profileManager.createProfile(defaultProfile);
            await conversation.getMemoryManager().switchProfile(defaultProfile.name);

            setNotification('✓ Создан профиль по умолчанию. Можете начать работу!');
            setInterviewMode(false);
            return;
          }

          const answer = interviewFlow.parseAnswer(currentQuestion, userInput);
          const newAnswers = { ...interviewAnswers, [currentQuestion.id]: answer };
          setInterviewAnswers(newAnswers);

          // Move to next question
          if (interviewStep < questions.length - 1) {
            setInterviewStep(interviewStep + 1);
            const nextQuestion = questions[interviewStep + 1];
            setNotification(
              `Вопрос ${interviewStep + 2}/${questions.length}:\n${nextQuestion.question}\n` +
              (nextQuestion.options ? nextQuestion.options.join('\n') : '')
            );
          } else {
            // Interview complete
            const validation = interviewFlow.validateAnswers(newAnswers);

            if (!validation.valid) {
              setNotification(`❌ Ошибка: ${validation.errors.join(', ')}`);
              setInterviewMode(false);
              return;
            }

            const profile = interviewFlow.buildProfile(newAnswers);
            await conversation.getMemoryManager().getProfileManager().createProfile(profile);
            await conversation.getMemoryManager().switchProfile(profile.name);

            setNotification(`✓ Профиль "${profile.name}" создан и активирован!`);
            setInterviewMode(false);
            setInterviewStep(0);
            setInterviewAnswers({});
          }

          return;
        }

        if (await handleCommand(userInput)) return;

        // RAG-режим: перехватываем сообщение и используем RAG-пайплайн
        if (ragMode) {
          setIsLoading(true);
          try {
            await conversation.addUserMessage(userInput);
            setMessages(conversation.getHistory());
            const ragAnswer = await ragQuery(userInput, ragManager, currentModel);
            const sourcesBlock =
              ragAnswer.sources.length > 0
                ? '\n\n─────────────────\n📚 Источники:\n' +
                  ragAnswer.sources
                    .map((s) => `• ${s.title}${s.section ? ` — ${s.section}` : ''} (${s.score.toFixed(2)})`)
                    .join('\n')
                : '';
            const fullAnswer = ragAnswer.answer + sourcesBlock;
            const metadata: MessageMetadata = {
              model: currentModel,
              timestamp: new Date().toISOString(),
            };
            await conversation.addAssistantMessage(fullAnswer, metadata);
            setMessages(conversation.getHistory());
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setNotification(`❌ RAG ошибка: ${msg}`);
          } finally {
            setIsLoading(false);
          }
          return;
        }

        setError(null);
        setToolCallLogs([]); // Очистить логи ДО добавления нового сообщения пользователя
        await conversation.addUserMessage(userInput);
        setMessages(conversation.getHistory());
        setIsLoading(true);

        try {
          // Check if summarization is needed before processing
          if (conversation.needsSummarization()) {
            await performSummarization(false);
          }

          // Build system prompt with memory context and invariants
          const formattedInvariants = invariantManager.getFormattedInvariants();
          const basePrompt = buildSystemPrompt(activeSkills, formattedInvariants);
          const systemPrompt = conversation.buildSystemPromptWithMemory(basePrompt);
          const apiMessages = await conversation.getMessagesForAPI();

          // Получить MCP-инструменты если подключены (включает LLM-driven tool calling)
          const mcpTools: MCPTool[] = mcpManager.isConnected()
            ? await mcpManager.listTools()
            : [];

          // Если MCP подключён — добавить подсказку в system prompt чтобы LLM
          // использовал инструменты напрямую для фактических запросов,
          // не ожидая прохождения через цикл планирования
          const finalSystemPrompt = mcpTools.length > 0
            ? (systemPrompt || '') + `\n\n=== MCP ИНСТРУМЕНТЫ ===\nДоступны инструменты: ${mcpTools.map(t => t.name).join(', ')}.\nДля простых информационных вопросов (время, данные, факты) — используй инструменты СРАЗУ, без планирования и уточняющих вопросов.`
            : systemPrompt;

          // Tool-calling loop: повторять пока LLM не вернёт финальный текстовый ответ
          // loopMessages — локальная копия, ходы с инструментами НЕ сохраняются в историю разговора
          let loopMessages = [...apiMessages];
          let apiResponse = await sendMessage(
            loopMessages,
            currentModel,
            finalSystemPrompt,
            temperature,
            mcpTools.length > 0 ? mcpTools : undefined
          );

          const MAX_TOOL_ITERATIONS = 10;
          let toolIteration = 0;

          try {
            while (apiResponse.toolCalls && apiResponse.toolCalls.length > 0 && toolIteration < MAX_TOOL_ITERATIONS) {
              toolIteration++;

              // Добавить ход ассистента (с tool_calls) только в локальный контекст
              loopMessages.push({
                role: 'assistant',
                content: apiResponse.content ?? '',
                tool_calls: apiResponse.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                })),
              });

              // Выполнить каждый вызов инструмента и добавить результаты в локальный контекст
              for (const toolCall of apiResponse.toolCalls) {
                const serverForTool = mcpManager.getServerForTool(toolCall.name) ?? 'unknown';
                setActiveMcpTool(`[${serverForTool}] ${toolCall.name}`);

                let toolResult: string;
                try {
                  toolResult = await mcpManager.callTool(toolCall.name, toolCall.arguments);
                } catch (err) {
                  toolResult = `Ошибка вызова инструмента: ${err instanceof Error ? err.message : String(err)}`;
                }

                // Добавить запись в лог инструментов (только для UI, не для LLM)
                const serverForLog = mcpManager.getServerForTool(toolCall.name) ?? 'unknown';
                setToolCallLogs((prev) => [
                  ...prev,
                  {
                    serverName: serverForLog,
                    toolName: toolCall.name,
                    result: toolResult.slice(0, 120),
                  },
                ]);

                // Сообщение role: 'tool' добавляется только в loopMessages, НЕ в историю разговора
                loopMessages.push({
                  role: 'tool',
                  content: toolResult,
                  tool_call_id: toolCall.id,
                });
              }

              // Запросить следующий ответ LLM (может вернуть ещё вызов инструмента или финальный ответ)
              apiResponse = await sendMessage(
                loopMessages,
                currentModel,
                finalSystemPrompt,
                temperature,
                mcpTools.length > 0 ? mcpTools : undefined
              );
            }
          } finally {
            // Сбросить индикатор всегда: при нормальном завершении, MAX_TOOL_ITERATIONS или ошибке
            setActiveMcpTool(null);
          }

          // State guard: блокируем реализацию в состоянии PLANNING
          const guardTask = conversation.getMemoryManager().getTaskStateMachine().getCurrentTask();
          if (guardTask?.currentState === TaskState.PLANNING) {
            const hasCode = /```[\s\S]*?```/.test(apiResponse.content);
            if (hasCode) {
              const guardMessage =
                `⛔ Заблокировано: нельзя перейти к реализации в состоянии PLANNING 🟡\n\n` +
                `Агент попытался начать выполнение до утверждения плана.\n\n` +
                `Сначала утвердите план, затем используйте \`/next\` для перехода в EXECUTION 🔵.`;
              const guardMetadata: MessageMetadata = {
                timestamp: new Date().toISOString(),
                model: currentModel,
              };
              await conversation.addAssistantMessage(guardMessage, guardMetadata);
              setMessages(conversation.getHistory());
              return;
            }
          }

          // Валидация ответа на соответствие инвариантам
          if (invariantsLoaded) {
            const validation = await invariantManager.validate(
              apiResponse.content,
              currentModel
            );

            if (!validation.valid) {
              // Показываем ошибку вместо ответа
              const errorMessage = invariantManager.formatViolationMessage(validation);
              const errorMetadata: MessageMetadata = {
                timestamp: new Date().toISOString(),
                model: currentModel,
              };
              await conversation.addAssistantMessage(errorMessage, errorMetadata);
              setMessages(conversation.getHistory());
              return;
            }
          }

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

          await conversation.addAssistantMessage(apiResponse.content, metadata);
          setMessages(conversation.getHistory());

          // Save to short-term memory
          await conversation.getMemoryManager().getShortTerm().save();

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

  // Initialize memory manager on app start
  useEffect(() => {
    conversation.initialize().catch(err => {
      console.error('Failed to initialize memory:', err);
    });
  }, []);

  // Check for profiles on startup
  useEffect(() => {
    const checkProfiles = async () => {
      const profileManager = conversation.getMemoryManager().getProfileManager();
      const hasProfiles = await profileManager.hasProfiles();

      if (!hasProfiles) {
        const interviewFlow = new InterviewFlow();
        const questions = interviewFlow.getQuestions();
        const firstQuestion = questions[0];

        setNotification(
          '👋 Добро пожаловать! Давайте настроим ваш профиль.\n\n' +
          'Начинаем интервью...\n' +
          '(Вы можете пропустить интервью, введя "skip" на первом вопросе)\n\n' +
          `Вопрос 1/${questions.length}: ${firstQuestion.question}`
        );
        setInterviewMode(true);
        setInterviewStep(0);
      }
    };

    checkProfiles().catch(err => {
      console.error('Failed to check profiles:', err);
    });
  }, []);

  // Load invariants on startup
  useEffect(() => {
    const loadInvariants = async () => {
      try {
        await invariantManager.load();
        setInvariantsLoaded(true);
      } catch (error) {
        console.error('Ошибка загрузки инвариантов:', error);
        // Продолжаем без инвариантов
        setInvariantsLoaded(true);
      }
    };
    loadInvariants();
  }, []);

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

  // Polling for fired reminders every 10 seconds (runs when MCP is connected)
  useEffect(() => {
    if (!isMcpConnected) return;

    const interval = setInterval(async () => {
      if (isPollingRef.current || !mcpManager.isConnected()) return;
      isPollingRef.current = true;
      try {
        const raw = await mcpManager.callTool('check_fired_reminders', {});
        const fired: Reminder[] = JSON.parse(raw);
        if (fired.length > 0) {
          const lines = fired.map((r) => `🔔 Напоминание: ${r.text}`).join('\n');
          setNotification(lines);
        }
      } catch {
        // Игнорируем ошибки polling
      } finally {
        isPollingRef.current = false;
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [isMcpConnected]);

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
          <Text color="yellow">/compact</Text> - выполнить суммаризацию контекста
        </Text>
        <Text dimColor>
          <Text color="yellow">/resume</Text> - восстановить сохраненную сессию
        </Text>
        <Text dimColor>
          <Text color="yellow">/stats</Text> - показать историю запросов с метриками
        </Text>
        <Text dimColor>
          <Text color="yellow">/strategy</Text> - управление стратегиями контекста | <Text color="yellow">/strategy [1-3]</Text>
        </Text>
        <Text dimColor>
          <Text color="yellow">/checkpoint</Text> - сохранить точку в истории для создания веток
        </Text>
        <Text dimColor>
          <Text color="yellow">/branch new &lt;имя&gt;</Text> - создать ветку для исследования альтернатив
        </Text>
        <Text dimColor>
          <Text color="yellow">/branch list</Text> - список веток | <Text color="yellow">/branch [номер]</Text> - переключиться | <Text color="yellow">/branch main</Text> - вернуться
        </Text>
        <Text dimColor>
          <Text color="yellow">/facts</Text> - показать извлечённые факты (Sticky Facts)
        </Text>
        <Text dimColor>
          <Text color="yellow">/memory</Text> - показать память агента | <Text color="yellow">/memory [short|working|long]</Text> - слой
        </Text>
        <Text dimColor>
          <Text color="yellow">/remember &lt;текст&gt;</Text> - запомнить факт
        </Text>
        <Text dimColor>
          <Text color="yellow">/task</Text> - показать текущую задачу | <Text color="yellow">/task new/list/load</Text> - управление задачами
        </Text>
        <Text dimColor>
          <Text color="yellow">/next</Text> - перейти к следующему этапу задачи (PLANNING → EXECUTION → VALIDATION → DONE)
        </Text>
        <Text dimColor>
          <Text color="yellow">/profile show/list/create</Text> - управление профилями | <Text color="yellow">/profile switch/delete</Text>
        </Text>
        <Text dimColor>
          <Text color="yellow">/constraint add/remove/list</Text> - ограничения
        </Text>
        <Text dimColor color="gray">
          💡 Branching: /checkpoint → /branch new → исследуйте вариант → /branch main
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
        {toolCallLogs.map((log, idx) => (
          <Box key={`tool-log-${idx}`} marginBottom={1} flexDirection="column">
            <Box>
              <Text color="magenta">🔧 </Text>
              <Text bold color="magenta">[{log.serverName}]</Text>
              <Text color="magenta"> › {log.toolName}</Text>
            </Box>
            <Box marginLeft={3}>
              <Text dimColor>{log.result.length > 100 ? log.result.slice(0, 100) + '...' : log.result}</Text>
            </Box>
          </Box>
        ))}
        {isLoading && (
          <Box>
            <Text bold color="blue">
              Assistant:{' '}
            </Text>
            {activeMcpTool ? (
              <Text color="magenta">🔧 Вызов MCP: {activeMcpTool}...</Text>
            ) : (
              <Text dimColor>[загрузка...]</Text>
            )}
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

      {getTaskStateDisplay(conversation) && (
        <Text color="cyan">
          {getTaskStateDisplay(conversation)}
        </Text>
      )}

      <Box>
        <Text color="yellow">&gt; </Text>
        <Text>{input}</Text>
        <Text backgroundColor="white"> </Text>
      </Box>
    </Box>
  );
};
