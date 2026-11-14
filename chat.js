(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.startsWith('YOUR_');
  const setupBanner = document.getElementById('setupBanner');
  const messagesEl = document.getElementById('messages');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const typing = document.getElementById('typing');
  const welcome = document.getElementById('welcome');
  const newChatBtn = document.getElementById('newChatBtn');
  const statusText = document.getElementById('statusText');
  let supabase = null, user = null, conversationId = localStorage.getItem('ai_conversation_id'), channel = null;
  const rendered = new Set();
  if (!configured) { setupBanner.hidden = false; statusText.textContent = '演示模式'; }
  else { supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); init(); }
  async function init() {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) return showFatal('匿名登录失败，请确认 Supabase 已开启 Anonymous Sign-Ins。');
    }
    const { data } = await supabase.auth.getUser();
    user = data.user;
    await ensureConversation();
    await loadMessages();
    subscribe();
  }
  async function ensureConversation(forceNew = false) {
    if (forceNew) conversationId = null;
    if (conversationId) {
      const { data } = await supabase.from('conversations').select('id').eq('id', conversationId).maybeSingle();
      if (data) return;
    }
    const { data, error } = await supabase.from('conversations').insert({ user_id: user.id }).select('id').single();
    if (error) return showFatal(error.message);
    conversationId = data.id;
    localStorage.setItem('ai_conversation_id', conversationId);
  }
  async function loadMessages() {
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at');
    if (error) return showFatal(error.message);
    messagesEl.querySelectorAll('.message-row').forEach(n => n.remove());
    rendered.clear();
    welcome.hidden = !!data?.length;
    (data || []).forEach(renderMessage);
    updateTyping(data || []);
  }
  function subscribe() {
    if (channel) supabase.removeChannel(channel);
    channel = supabase.channel('conversation:' + conversationId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conversationId }, payload => {
        renderMessage(payload.new);
        if (payload.new.role === 'assistant') typing.hidden = true;
      }).subscribe();
  }
  function renderMessage(msg) {
    if (rendered.has(msg.id)) return;
    rendered.add(msg.id); welcome.hidden = true;
    const row = document.createElement('div');
    row.className = 'message-row ' + msg.role;
    row.innerHTML = '<div class="avatar">' + (msg.role === 'assistant' ? 'AI' : '你') + '</div><div class="bubble"><div>' + escapeHtml(msg.content) + '</div><div class="message-time">' + formatTime(msg.created_at) + '</div></div>';
    messagesEl.appendChild(row); messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  async function sendMessage(text) {
    sendBtn.disabled = true;
    const { error } = await supabase.from('messages').insert({ conversation_id: conversationId, user_id: user.id, role: 'user', content: text });
    sendBtn.disabled = false;
    if (error) return showFatal(error.message);
    typing.hidden = false;
  }
  function updateTyping(list) { typing.hidden = !list.length || list[list.length - 1].role !== 'user'; }
  form.addEventListener('submit', async e => { e.preventDefault(); const text = input.value.trim(); if (!text) return; input.value=''; resizeInput(); await sendMessage(text); });
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  document.querySelectorAll('.suggestion').forEach(btn => btn.addEventListener('click', () => { input.value = btn.textContent; input.focus(); resizeInput(); }));
  newChatBtn.addEventListener('click', async () => { if (!user) return; await ensureConversation(true); await loadMessages(); subscribe(); });
  function resizeInput(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,170)+'px'; }
  function formatTime(v){ return new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); }
  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
  function showFatal(msg){ setupBanner.hidden=false; setupBanner.textContent=msg; }
})();