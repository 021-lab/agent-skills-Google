// Minimal fixture app used only by tests/emulate.e2e.spec.js to prove the
// emulate() API drives a real page through a real browser, reaching the
// single app handler exactly as live user input would.
import { VoiceApp } from '/src/voiceframe.js';

const state = { items: [] };

const app = await VoiceApp.init({ debug: true });

app.handle(async (ctx) => {
  if (ctx.type === 'say' && ctx.transcript) {
    // Route the mutation through ctx.db so it auto-records on the undo
    // stack, exercising the same path a real app would use.
    await ctx.db.put('mutations', { id: `item-${state.items.length}`, text: ctx.transcript });

    state.items.push(ctx.transcript);
    const li = document.createElement('li');
    li.textContent = ctx.transcript;
    li.dataset.testid = 'item';
    document.getElementById('log-output').appendChild(li);
    ctx.log({ recorded: ctx.transcript });
  }
});

// Test-only hooks — not part of the framework's public contract.
window.__testState = state;
window.__voiceframeApp = app;
