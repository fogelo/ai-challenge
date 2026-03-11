import { ModelInfo, ModelsApiResponse, UsageInfo } from '../types/index.js';

export class ModelRegistry {
  private models: Map<string, ModelInfo> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data: ModelsApiResponse = await response.json();

      for (const model of data.data) {
        this.models.set(model.id, model);
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to load models from OpenRouter:', error);
      // Fallback: add Claude 3.5 Sonnet with hardcoded prices
      this.models.set('anthropic/claude-3.5-sonnet', {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        pricing: {
          prompt: '0.000003',
          completion: '0.000015',
        },
      });
      this.initialized = true;
    }
  }

  getModel(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  calculateCost(modelId: string, usage: UsageInfo): number {
    const model = this.models.get(modelId);

    if (!model || !model.pricing) {
      return 0;
    }

    const promptPrice = parseFloat(model.pricing.prompt);
    const completionPrice = parseFloat(model.pricing.completion);

    if (isNaN(promptPrice) || isNaN(completionPrice)) {
      return 0;
    }

    const inputCost = usage.prompt_tokens * promptPrice;
    const outputCost = usage.completion_tokens * completionPrice;

    return inputCost + outputCost;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
