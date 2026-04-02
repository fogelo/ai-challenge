# Memory Layers Verification

**Date:** 2026-03-02
**Feature:** Memory layers implementation

## Test Scenarios

### Test 1: Short-term Memory (Current Dialog)

**Goal:** Verify agent remembers previous messages in current session

**Steps:**
1. Start app: `npm start`
2. User: "Меня зовут Антон"
3. Assistant responds
4. User: "Как меня зовут?"
5. Assistant should say: "Вас зовут Антон"

**Expected:** ✓ Agent remembers name from earlier in conversation

**Result:**

### Test 2: Working Memory (Task Context)

**Goal:** Verify task context influences responses

**Steps:**
1. Start app
2. User: `/task start Реализовать команду /memory`
3. User: "Как мне это сделать?"
4. Assistant should understand "это" = текущая задача

**Expected:** ✓ Agent understands implicit reference to active task

**Result:**

### Test 3: Long-term Memory (Profile)

**Goal:** Verify profile affects code generation

**Steps:**
1. Start app
2. User: `/profile set stack TypeScript`
3. User: "Напиши функцию для чтения файла"
4. Assistant should generate TypeScript code

**Expected:** ✓ Agent uses TypeScript from profile

**Result:**

### Test 4: Constraints

**Goal:** Verify constraints prevent unwanted suggestions

**Steps:**
1. Start app
2. User: `/constraint add forbidden Python`
3. User: "Напиши скрипт для парсинга JSON"
4. Assistant should NOT suggest Python

**Expected:** ✓ Agent respects forbidden constraint

**Result:**

### Test 5: Knowledge Facts

**Goal:** Verify remembered facts are used

**Steps:**
1. Start app
2. User: `/remember В проекте используется Ink для CLI UI`
3. User: "Как вывести цветной текст в консоли?"
4. Assistant should mention Ink and <Text> component

**Expected:** ✓ Agent uses remembered project knowledge

**Result:**

## Verification Checklist

- [ ] All memory commands work (/memory, /remember, /task, /profile, /constraint)
- [ ] Memory persists to files in .memory/ directory
- [ ] System prompt includes memory context
- [ ] Responses respect profile and constraints
- [ ] Help text documents all commands
