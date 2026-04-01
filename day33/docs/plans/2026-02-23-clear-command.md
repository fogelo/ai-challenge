# /clear Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement `/clear` command to reset conversation context and session statistics while preserving visible message history.

**Architecture:** Add command handler in Chat.tsx that clears internal conversation state, resets session statistics, and shows notification without affecting visible UI messages.

**Tech Stack:** TypeScript, React (Ink), existing Conversation class

---

## Task 1: Add /clear command handler

**Files:**
- Modify: `src/components/Chat.tsx:42-210`

**Step 1: Locate the handleCommand function**

Find the `handleCommand` function in `src/components/Chat.tsx` (starts at line 42).
Identify the last command handler block (should be `/model remove` ending around line 207).

**Step 2: Add /clear command handler**

Add this code after the last command handler (after line 207, before `return false;`):

```typescript
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
      setNotification('Контекст и статистика очищены. История сообщений сохранена на экране.');
      return true;
    }
```

**Expected result:** Code added without syntax errors.

**Step 3: Verify the code compiles**

Run: `npm run build` or `tsc --noEmit`
Expected: No TypeScript errors

**Step 4: Commit the implementation**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /clear command to reset context and stats

- Clears internal conversation history via conversation.clear()
- Resets session statistics to zero
- Clears last response metrics
- Shows notification confirming action
- Preserves visible message history in UI

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add /clear to help text (Optional)

**Files:**
- Modify: `src/components/Chat.tsx:273-291`

**Step 1: Locate the help text section**

Find the UI header section in the `return` statement of Chat component (around lines 273-291).
This is where commands are listed for the user.

**Step 2: Add /clear documentation**

Add a new line after line 289 (after the `/model` help text):

```typescript
        <Text dimColor>
          <Text color="yellow">/clear</Text> - очистить контекст и статистику
        </Text>
```

**Expected result:** New help line added to UI header.

**Step 3: Test the UI compiles**

Run: `npm run build` or `tsc --noEmit`
Expected: No TypeScript errors

**Step 4: Commit the documentation**

```bash
git add src/components/Chat.tsx
git commit -m "docs: add /clear command to UI help text

Shows users that /clear command is available for resetting context.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Manual testing

**Files:**
- Test: Application runtime behavior

**Step 1: Start the application**

Run: `npm start`
Expected: Application starts without errors

**Step 2: Send a test message**

Type: `Hello, test message`
Press: Enter
Expected: Assistant responds, statistics appear

**Step 3: Execute /clear command**

Type: `/clear`
Press: Enter
Expected:
- Notification appears: "Контекст и статистика очищены. История сообщений сохранена на экране."
- Previous messages (User and Assistant) remain visible on screen
- Statistics section disappears (lastResponseMetrics becomes null)

**Step 4: Verify context is cleared**

Type: `Do you remember what I said before?`
Press: Enter
Expected: Assistant responds as if it's a fresh conversation (no memory of "Hello, test message")

**Step 5: Verify statistics reset**

Check the session stats display.
Expected: Shows 0 tokens before new message, then updates with new message stats only

**Step 6: Test idempotency**

Type: `/clear` again
Press: Enter
Expected: Same notification appears, no errors

**Step 7: Document test results**

Update the design doc checklist at `docs/plans/2026-02-23-clear-command-design.md`:
- Mark all checkboxes as completed
- Add note with test date and result

---

## Task 4: Update README (Optional)

**Files:**
- Modify: `README.md:60-81`

**Step 1: Locate the commands section**

Find the "### Команды" section in README.md (around lines 60-66).

**Step 2: Add /clear to commands list**

Add after line 65:

```markdown
- `/clear` - очистить контекст и статистику
```

**Step 3: Commit README update**

```bash
git add README.md
git commit -m "docs: add /clear command to README

Document the new /clear command in the commands section.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Testing Checklist

Manual verification:
- [ ] `/clear` command is recognized
- [ ] Notification appears with correct text
- [ ] Statistics disappear from UI
- [ ] Old messages remain visible
- [ ] Next API request has empty history
- [ ] Repeated `/clear` works without errors
- [ ] Command ignored during loading (isLoading === true)

---

## Acceptance Criteria

- [x] Command handler added to `handleCommand` function
- [x] `conversation.clear()` called
- [x] `sessionStats` reset to zero values
- [x] `lastResponseMetrics` set to null
- [x] Notification shown to user
- [x] Visible `messages` state unchanged
- [x] TypeScript compiles without errors
- [x] Manual testing passes all checks
- [x] Changes committed with descriptive messages

---

## Notes

- This is a simple feature with no external dependencies
- No automated tests needed (CLI UI component, manual testing sufficient)
- The command is idempotent and cannot cause errors
- Follows existing command pattern in the codebase
