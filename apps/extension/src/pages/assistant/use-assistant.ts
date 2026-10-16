import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { measurePost, postingPolicy, type PostingPolicy, type AssistantCatalog, type AssistantChatResult, type AssistantContext, type SkillKey } from "@fast-social/contracts";
import { config, initConfig } from "../../common/storage-config";
import { requestLocalService } from "../../common/local-service";
import { LocalServiceClient } from "../../background/local-service-client";
import { draftError, parseSkillCommand } from "../../assistant/context-guard";
import { ConversationStore, conversationTitle, conversationReference, draftContext, newConversation, requestHistory, sameAccount, type ChatMessage, type Conversation } from "../../assistant/conversations";
import { commandKey, skillQuery } from "../../assistant/skill-commands";
import { confirmOperation } from '../../components/ui/confirm-operation';

export function useAssistant() {
  let store = new ConversationStore(chrome.storage.local);
  const client = new LocalServiceClient();
  const current = ref<Conversation>(newConversation()), conversations = ref<Conversation[]>([]);
  const context = ref<AssistantContext | null>(null), catalog = ref<AssistantCatalog | null>(null);
  const busy = ref(false), ready = ref(false), filling = ref<string | null>(null);
  const error = ref(""), notice = ref(""), historyOpen = ref(false), search = ref("");
  const inputElement = ref<HTMLTextAreaElement>(), chatArea = ref<HTMLElement>();
  const selectedCommand = ref(0), caret = ref(0), menuDismissed = ref(false);
  const runningSkill = ref<SkillKey>();
  let windowId: number | undefined, ownerTabId: number | undefined, readVersion = 0, disposed = false;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let accountQueue = Promise.resolve(), accountInitialized = false;
  const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);
  const fallbackSkills = [
    { key: "summary" as const, name: "总结", description: "提炼当前页面的要点" },
    { key: "post" as const, name: "发帖", description: "把你的想法写成一条 Post" },
    { key: "reply" as const, name: "回复", description: "回应当前正在看的帖子" },
  ];
  const skills = computed(() => catalog.value?.skills ?? fallbackSkills);
  const accountName = computed(() => context.value?.account.displayName || context.value?.account.username || "");
  const input = computed({ get: () => current.value.draft, set: value => { current.value.draft = value; } });
  const messages = computed(() => current.value.messages);
  const explicitSkill = computed(() => parseSkillCommand(input.value).skill);
  const lastSkill = computed(() => [...messages.value].reverse().find(m => m.role === 'assistant')?.skill);
  const skillName = (key: SkillKey) => skills.value.find(s => s.key === key)?.name ?? fallbackSkills.find(s => s.key === key)?.name ?? key;
  const query = computed(() => skillQuery(input.value, caret.value));
  const matchingSkills = computed(() => query.value === null ? [] : skills.value.filter(s => s.key.startsWith(query.value!)));
  const showCommands = computed(() => !menuDismissed.value && !busy.value && matchingSkills.value.length > 0);
  const history = computed(() => conversations.value.filter(c => sameAccount(c.account, context.value?.account ?? null)).filter(c => c.messages.length || c.draft.trim()).filter(c =>
    !search.value.trim() || (c.title + " " + (c.account?.displayName || c.account?.username || "")).toLowerCase().includes(search.value.trim().toLowerCase())));
  watch(query, () => { selectedCommand.value = 0; menuDismissed.value = false; });
  watch(selectedCommand, async () => {
    await nextTick();
    document.getElementById(`skill-option-${selectedCommand.value}`)?.scrollIntoView({ block: "nearest" });
  });

  function remember(conversation: Conversation) {
    const snapshot = JSON.parse(JSON.stringify(conversation)) as Conversation;
    conversations.value = [snapshot, ...conversations.value.filter(c => c.id !== snapshot.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function persist(conversation = current.value): Promise<void> {
    if (!conversation.messages.length && !conversation.draft.trim()) {
      if (conversations.value.some(c => c.id === conversation.id)) {
        await store.remove(conversation.id);
        conversations.value = conversations.value.filter(c => c.id !== conversation.id);
      }
      return;
    }
    conversation.updatedAt = Date.now();
    remember(conversation);
    try { await store.save(conversation); }
    catch { throw new Error("聊天记录未能保存，请检查浏览器存储空间。当前对话仍保留在页面中。"); }
  }
  function saveDraft() {
    caret.value = inputElement.value?.selectionStart ?? input.value.length;
    resizeInput();
    clearTimeout(draftTimer);
    const conversation = current.value;
    draftTimer = setTimeout(() => { void persist(conversation).catch(e => { error.value = messageOf(e); }); }, 160);
  }
  async function flush() { clearTimeout(draftTimer); await persist(); }
  function resizeInput() {
    const el = inputElement.value;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(180, Math.max(52, el.scrollHeight)) + "px"; }
  }
  async function activeTab() { return ownerTabId === undefined ? (await chrome.tabs.query({ active: true, windowId }))[0] : chrome.tabs.get(ownerTabId); }
  async function capture(id: number): Promise<AssistantContext> {
    let result;
    try { result = await chrome.tabs.sendMessage(id, { type: "assistant-context" }); }
    catch { throw new Error("无法读取 X 页面，请刷新该页面后再试。"); }
    if (!result?.ok) throw new Error(result?.error || "无法读取 X 页面，请刷新该页面后再试。");
    return result.context;
  }
  async function readPage(required = false): Promise<{ context: AssistantContext; tabId: number } | null> {
    const version = ++readVersion;
    try {
      const tab = await activeTab();
      if (!tab?.id || !/^https:\/\/([^.\/]+\.)?x\.com\//.test(tab.url ?? "")) throw new Error("请打开 X 页面后再试。");
      const snapshot = await capture(tab.id);
      const changeAccount = accountQueue.catch(() => {}).then(async () => {
        if (version !== readVersion || disposed) return;
        if (!accountInitialized || !sameAccount(current.value.account, snapshot.account)) {
          const wasReady = ready.value;
          ready.value = false;
          try {
            await flush();
            const saved = await store.list(snapshot.account), id = await store.activeId(snapshot.account);
            if (version !== readVersion || disposed) return;
            conversations.value = saved;
            const restored = saved.find(c => c.id === id) ?? (!id ? saved[0] : undefined);
            current.value = restored ? JSON.parse(JSON.stringify(restored)) : newConversation(snapshot.account);
            current.value.account = { ...snapshot.account };
            if (current.value.pending && !busy.value) {
              const pending = current.value.messages.find(m => m.id === current.value.pending);
              if (pending) pending.error = '上次生成已中断，可以重试。';
              current.value.pending = null; await persist();
            }
            await store.activate(current.value.id, snapshot.account);
            accountInitialized = true;
            historyOpen.value = false; search.value = ''; deleted.value = null; error.value = ''; notice.value = '';
            await nextTick(); resizeInput();
          } finally { ready.value = wasReady; }
        }
        context.value = snapshot;
      });
      accountQueue = changeAccount;
      await changeAccount;
      return { context: snapshot, tabId: tab.id };
    } catch (e) {
      if (version === readVersion) context.value = null;
      if (required) throw e;
      return null;
    }
  }
  async function loadCatalog() {
    const identity = context.value?.account ?? { actorId: "", username: "" };
    try {
      catalog.value = await requestLocalService<AssistantCatalog>("/api/assistant/catalog?" + new URLSearchParams({ actorId: identity.actorId, username: identity.username }));
    } catch { catalog.value = null; }
  }
  async function focusInput() { await nextTick(); resizeInput(); inputElement.value?.focus(); }
  async function startNew() {
    if (busy.value) return;
    try {
      await flush();
      await readPage();
      current.value = newConversation(context.value?.account ?? null);
      await store.activate(current.value.id, current.value.account);
      historyOpen.value = false; error.value = ""; notice.value = "";
      await loadCatalog(); await focusInput();
    } catch (e) { error.value = messageOf(e); }
  }
  async function openConversation(conversation: Conversation) {
    if (busy.value) return;
    try {
      await flush();
      await readPage(true);
      if (!sameAccount(conversation.account, context.value?.account ?? null)) throw new Error('这段聊天属于另一个 X 账号，请切回该账号后查看。');
      current.value = JSON.parse(JSON.stringify(conversations.value.find(c => c.id === conversation.id) ?? conversation));
      await store.activate(conversation.id, current.value.account);
      historyOpen.value = false; error.value = ""; notice.value = "";
      await scrollDown(); await focusInput();
    } catch (e) { error.value = messageOf(e); }
  }
  async function toggleHistory() {
    if (busy.value) return;
    try {
      await flush();
      await readPage();
      if (!historyOpen.value) conversations.value = await store.list(context.value?.account ?? null);
      historyOpen.value = !historyOpen.value; search.value = "";
    } catch (e) { error.value = messageOf(e); }
  }
  const deleted = ref<Conversation | null>(null);
  async function removeConversation(conversation: Conversation) {
    if (busy.value) return;
    try {
      clearTimeout(draftTimer);
      await readPage(true);
      if (!sameAccount(conversation.account, context.value?.account ?? null)) throw new Error('账号已切换，请在原账号的历史中删除这段聊天。');
      await store.remove(conversation.id);
      conversations.value = conversations.value.filter(c => c.id !== conversation.id);
      deleted.value = JSON.parse(JSON.stringify(conversation));
      if (current.value.id === conversation.id) { current.value = newConversation(context.value?.account ?? null); await store.activate(current.value.id, current.value.account); }
      notice.value = "会话已删除";
    } catch (e) { error.value = messageOf(e); }
  }
  async function undoDelete() {
    if (!deleted.value) return;
    const conversation = deleted.value;
    try {
      await readPage(true);
      if (!sameAccount(conversation.account, context.value?.account ?? null)) return;
      await store.save(conversation); remember(conversation); deleted.value = null; notice.value = "已恢复会话";
    }
    catch (e) { error.value = messageOf(e); }
  }
  function chooseCommand(key: SkillKey) {
    input.value = `/${key} `; caret.value = input.value.length; menuDismissed.value = true;
    void nextTick().then(() => { inputElement.value?.setSelectionRange(input.value.length, input.value.length); saveDraft(); return focusInput(); });
  }
  async function useShortcut(key: SkillKey) {
    if (busy.value) return;
    chooseCommand(key);
    if (key === "summary" || key === "reply") await send();
  }
  async function send(retry?: ChatMessage) {
    if (busy.value || !ready.value || (!retry && !input.value.trim())) return;
    const originalInput = retry ? retry.content : input.value;
    const command = parseSkillCommand(originalInput);
    if (command.error) { error.value = command.error; return; }
    const chosen = retry?.skill ?? command.skill;
    const request = command.input || (chosen === "summary" ? "总结当前页面，提炼关键观点。" : chosen === "reply" ? "根据当前原帖生成一条自然的回复。" : "根据已有草稿和选中素材写一条 Post；没有素材时先问我想表达什么。");
    error.value = ""; notice.value = ""; deleted.value = null; busy.value = true; runningSkill.value = chosen;
    let conversation = current.value, user: ChatMessage | undefined, generated = false;
    try {
      await flush();
      const fresh = (await readPage(true))!;
      await loadCatalog();
      if (catalog.value && chosen && !catalog.value.skills.some(s => s.key === chosen)) throw new Error(`/${chosen} 已停用或文件不可用，请检查互动 Skills 设置。`);
      if (conversation.id !== current.value.id || !sameAccount(conversation.account, fresh.context.account))
        throw new Error('X 账号已切换，草稿保留在原账号会话中。请在当前账号重新输入。');
      if (chosen === "reply" && !fresh.context.target) throw new Error("请先在 X 打开想回复的帖子或它的回复框，再试一次。");
      const before = retry ? conversation.messages.slice(0, conversation.messages.findIndex(m => m.id === retry.id)) : [...conversation.messages];
      const previousSkill = [...before].reverse().find(m => m.role === "assistant")?.skill;
      user = retry ? conversation.messages.find(m => m.id === retry.id) : undefined;
      if (!user) {
        user = { id: crypto.randomUUID(), role: "user", content: request, createdAt: Date.now(), ...(chosen ? { skill: chosen, skillSource: 'command' as const } : {}) };
        conversation.messages.push(user);
        user = conversation.messages[conversation.messages.length - 1];
      }
      delete user.error;
      user.reference = conversationReference(fresh.context, chosen);
      conversation.account = { ...fresh.context.account };
      if (conversation.messages.length === 1) conversation.title = conversationTitle(request);
      conversation.pending = user.id; conversation.draft = "";
      await persist(conversation); await store.activate(conversation.id, conversation.account); await scrollDown(); resizeInput();
      const result = await client.request<AssistantChatResult>("/api/assistant/chat", { method: "POST", body: {
        skill: chosen, previousSkill, input: request, history: requestHistory(before), context: fresh.context, targetLanguage: config.value.basic.targetLang,
      } });
      user.skill = result.skill; user.skillSource ??= 'inferred';
      user.reference = conversationReference(fresh.context, result.skill);
      conversation.messages.push({ id: crypto.randomUUID(), role: "assistant", content: result.content, skill: result.skill,
        context: draftContext(fresh.context), ...(result.draft ? { validation: result.draft } : {}), createdAt: Date.now() });
      generated = true;
      conversation.pending = null;
      await persist(conversation);
    } catch (e) {
      error.value = messageOf(e);
      if (user && !generated) { user.error = error.value; conversation.pending = null; await persist(conversation).catch(() => {}); }
      else if (!user) { conversation.draft = originalInput; await persist(conversation).catch(() => {}); }
    } finally {
      if (current.value.id === conversation.id && current.value !== conversation) current.value = JSON.parse(JSON.stringify(conversation));
      busy.value = false; runningSkill.value = undefined; await scrollDown(); await focusInput();
    }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notice.value = "已复制"; error.value = ""; }
    catch { error.value = "复制失败，请选中文案后手动复制。"; }
  }
  async function fill(message: ChatMessage) {
    if (busy.value || filling.value || !message.context || !message.skill) return;
    filling.value = message.id; error.value = ""; notice.value = "";
    try {
      if (!await confirmOperation({title: '确认填入草稿', message: '将读取当前账号的 Profile 核对发帖权限，再把文案填入 X 草稿。是否继续？'})) return;
      const fresh = (await readPage(true))!;
      const invalid = draftError(message.context, fresh.context, message.skill);
      if (invalid) throw new Error(invalid);
      let policy: PostingPolicy;
      try {
        const detected = await client.request<PostingPolicy>('/api/assistant/posting-policy', { method: 'POST', body: fresh.context.account });
        policy = postingPolicy(detected.blueVerified ?? fresh.context.account.blueVerified);
      }
      catch { policy = postingPolicy(fresh.context.account.blueVerified); }
      const measured = measurePost(message.content, policy.maxWeightedLength);
      if (!measured.valid) throw new Error(`当前账号的文案限制为 ${policy.maxWeightedLength} 加权字符，这条文案为 ${measured.weightedLength}，请重新生成短版或确认账号的长文权限。`);
      const result = await chrome.tabs.sendMessage(fresh.tabId, { type: "assistant-fill", context: message.context, skill: message.skill, text: message.content, maxWeightedLength: policy.maxWeightedLength });
      if (!result?.ok) throw new Error(result?.error || "未能填入草稿，请复制文案。");
      message.context.composer = result.composer;
      await persist(); notice.value = "已填入 X 草稿";
    } catch (e) { error.value = messageOf(e); }
    finally { filling.value = null; }
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (showCommands.value && !event.shiftKey) {
      const result = commandKey(event.key, matchingSkills.value.length, selectedCommand.value);
      if (result.handled) {
        event.preventDefault(); selectedCommand.value = result.selected;
        if (result.confirm !== undefined) chooseCommand(matchingSkills.value[result.confirm].key);
        if (result.dismiss) menuDismissed.value = true;
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }
  async function scrollDown() { await nextTick(); if (chatArea.value) chatArea.value.scrollTop = chatArea.value.scrollHeight; }
  const activated = (info: chrome.tabs.TabActiveInfo) => { if (info.windowId === windowId) void readPage().then(loadCatalog); };
  const updated = (_id: number, info: chrome.tabs.TabChangeInfo) => { if (info.url || info.status === "complete") void readPage().then(loadCatalog); };
  const persistBeforeClose = () => { clearTimeout(draftTimer); void persist().catch(() => {}); };
  const focused = () => { void readPage().then(loadCatalog); };
  const shown = (event: MessageEvent) => {
    // The parent may request focus only. Never accept chat content or actions from page messages.
    if (event.source === window.parent && event.data?.type === 'fast-social-assistant-shown') void readPage().then(loadCatalog).then(() => { if (!historyOpen.value) return focusInput(); });
  };
  onMounted(async () => {
    try {
      windowId = (await chrome.windows.getCurrent()).id;
      ownerTabId = (await chrome.tabs.getCurrent())?.id;
      store = new ConversationStore(chrome.storage.local, ownerTabId);
      await initConfig();
    } catch (e) { error.value = messageOf(e); }
    await readPage(); await loadCatalog(); ready.value = true;
    chrome.tabs.onActivated.addListener(activated); chrome.tabs.onUpdated.addListener(updated);
    window.addEventListener("pagehide", persistBeforeClose);
    window.addEventListener("focus", focused);
    window.addEventListener("message", shown);
    await scrollDown(); await focusInput();
  });
  onBeforeUnmount(() => {
    disposed = true; readVersion++; persistBeforeClose();
    chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated);
    window.removeEventListener("pagehide", persistBeforeClose);
    window.removeEventListener("focus", focused);
    window.removeEventListener("message", shown);
  });
  return { current, input, messages, skills, accountName, busy, ready, filling, error, notice, historyOpen, search, explicitSkill, lastSkill, runningSkill, skillName,
    history, deleted, inputElement, chatArea, caret, showCommands, matchingSkills, selectedCommand,
    startNew, openConversation, toggleHistory, removeConversation, undoDelete, chooseCommand, useShortcut,
    send, copy, fill, onKeydown, saveDraft };
}
