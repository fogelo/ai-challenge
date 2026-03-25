import { IContextStrategy } from './IContextStrategy.js';
import { Message, BranchingState, Checkpoint, Branch } from '../types/index.js';

/**
 * Generates unique ID for checkpoints and branches
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Branching strategy: create conversation branches with checkpoints
 */
export class BranchingStrategy implements IContextStrategy {
  private baseMessages: Message[] = [];
  private checkpoints: Checkpoint[] = [];
  private branches: Branch[] = [];
  private currentBranchId: string | null = null;
  private maxCheckpoints: number;

  constructor(maxCheckpoints: number = 20) {
    this.maxCheckpoints = maxCheckpoints;
  }

  async addMessage(message: Message): Promise<void> {
    if (this.currentBranchId) {
      // Add to current branch
      const branch = this.branches.find(b => b.id === this.currentBranchId);
      if (branch) {
        branch.messages.push(message);
      }
    } else {
      // Add to base messages
      this.baseMessages.push(message);
    }
  }

  async getMessagesForAPI(): Promise<Message[]> {
    if (!this.currentBranchId) {
      return this.baseMessages;
    }

    const branch = this.branches.find(b => b.id === this.currentBranchId);
    if (!branch) {
      return this.baseMessages;
    }

    const checkpoint = this.checkpoints.find(c => c.id === branch.checkpointId);
    if (!checkpoint) {
      return this.baseMessages;
    }

    // Return: messages before checkpoint + branch messages
    return [
      ...this.baseMessages.slice(0, checkpoint.messageIndex),
      ...branch.messages,
    ];
  }

  clear(): void {
    this.baseMessages = [];
    this.checkpoints = [];
    this.branches = [];
    this.currentBranchId = null;
  }

  getName(): string {
    return 'Branching';
  }

  serialize(): BranchingState {
    return {
      type: 'branching',
      messages: this.baseMessages,
      checkpoints: this.checkpoints,
      branches: this.branches,
      currentBranchId: this.currentBranchId,
    };
  }

  restore(state: BranchingState): void {
    if (state.type !== 'branching') {
      throw new Error('Invalid state type for BranchingStrategy');
    }
    this.baseMessages = state.messages;
    this.checkpoints = state.checkpoints;
    this.branches = state.branches;
    this.currentBranchId = state.currentBranchId;
  }

  // Branch management methods

  createCheckpoint(name?: string): string {
    const messageCount = this.getCurrentMessages().length;

    const checkpoint: Checkpoint = {
      id: generateId(),
      timestamp: Date.now(),
      messageIndex: messageCount,
      name,
    };

    this.checkpoints.push(checkpoint);

    // Enforce max checkpoints limit
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.shift();
    }

    return checkpoint.id;
  }

  createBranch(name: string, checkpointId?: string): string {
    if (this.checkpoints.length === 0) {
      throw new Error('No checkpoints available. Create checkpoint first with /checkpoint');
    }

    // Use provided checkpoint or last one
    const targetCheckpointId = checkpointId || this.checkpoints[this.checkpoints.length - 1].id;
    const checkpoint = this.checkpoints.find(c => c.id === targetCheckpointId);

    if (!checkpoint) {
      throw new Error('Checkpoint not found');
    }

    const branch: Branch = {
      id: generateId(),
      name,
      checkpointId: targetCheckpointId,
      messages: [],
      createdAt: Date.now(),
    };

    this.branches.push(branch);
    this.currentBranchId = branch.id;

    return branch.id;
  }

  switchBranch(branchId: string): void {
    const branch = this.branches.find(b => b.id === branchId);
    if (!branch) {
      throw new Error('Branch not found');
    }
    this.currentBranchId = branchId;
  }

  switchToMain(): void {
    this.currentBranchId = null;
  }

  getCurrentBranch(): Branch | null {
    if (!this.currentBranchId) {
      return null;
    }
    return this.branches.find(b => b.id === this.currentBranchId) || null;
  }

  listBranches(): Array<{ id: string; name: string; messageCount: number; isCurrent: boolean }> {
    return this.branches.map(b => ({
      id: b.id,
      name: b.name,
      messageCount: b.messages.length,
      isCurrent: b.id === this.currentBranchId,
    }));
  }

  listCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  private getCurrentMessages(): Message[] {
    if (!this.currentBranchId) {
      return this.baseMessages;
    }

    const branch = this.branches.find(b => b.id === this.currentBranchId);
    if (!branch) {
      return this.baseMessages;
    }

    const checkpoint = this.checkpoints.find(c => c.id === branch.checkpointId);
    if (!checkpoint) {
      return this.baseMessages;
    }

    return [
      ...this.baseMessages.slice(0, checkpoint.messageIndex),
      ...branch.messages,
    ];
  }
}
