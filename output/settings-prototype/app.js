/* Static review prototype only. No extension APIs or backend requests. */
(()=>{
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const CACHE_KEY='fast-social-settings-review-v3-prompt-cache';
  const BASIC_KEY='fast-social-settings-review-v3-basic';
  const state={online:true,page:'accounts',prompt:'105',filter:'all',editMode:'form',dialog:null,accountId:null,workflow:null,cache:null};
  const labels={post:'发帖',reply:'回复'};
  const actionLabels={follow:'关注作者',reply:'回复 Post',notify:'发送通知'};
  const prompts=[
    {id:'101',n:63,name:'英文润色',scene:'post',text:'将下面草稿改写为自然、简洁的英文帖子。保留我的原意、事实和语气，不补充未提供的信息，不使用营销腔。只输出正文。\n\n{input}'},
    {id:'102',n:64,name:'自然英文回复',scene:'reply',text:'根据原帖和我的想法，写一条自然、具体的英文回复。不空泛夸赞，不虚构事实。只输出正文。\n\n原帖：{reply}\n我的想法：{input}'},
    {id:'103',n:65,name:'中文精简',scene:'post',text:'精简下面的中文内容，删掉重复和铺垫，保留我的个人口吻、核心判断与立场。不要添加新观点。只输出正文。\n\n{input}'},
    {id:'104',n:66,name:'中文观点回复',scene:'reply',text:'结合原帖，帮助我把自己的观点表达得更清楚。以我的输入为准，不替我增加立场。\n\n原帖：{reply}\n我的观点：{input}'},
    {id:'105',n:155,name:'社交媒体翻译',scene:'post',text:'请将下面的社交媒体内容翻译为 {{_tl_}}。保留原意、语气与段落，人名、账号、链接及术语可保留原文，不补充原文没有的信息。只输出译文。\n\n{input}'}
  ];
  const accounts=[
    {id:'account-en',name:'海外交流',handle:'@demo_global',platform:'X / Twitter',cookieConfigured:true,configs:['auto-translate','101','102'],editN:34},
    {id:'account-cn',name:'中文表达',handle:'@demo_cn',platform:'X / Twitter',cookieConfigured:true,configs:['103','104'],editN:158}
  ];
  const workflows=[
    {id:'wf-launch',name:'产品发布通知',account:'account-en',interval:15,source:'user',targets:'@demo_creator',condition:'当帖子明确发布新产品、开放试用或提供上线时间时执行动作。忽略普通转发与泛泛的预告。',enabled:true,toggleN:113,editN:115,actions:[{type:'notify',n:300,channel:'Telegram',content:'原帖链接、内容摘要与命中原因'}]},
    {id:'wf-connect',name:'发现同领域创作者',account:'account-en',interval:30,source:'home',targets:'',condition:'帖子明确发出互关邀请，作者讨论独立开发或产品建设，且原帖中有具体内容。',enabled:false,toggleN:160,editN:161,actions:[{type:'follow',n:310},{type:'reply',n:320,mode:'text',text:'Followed! Happy to connect.',promptId:'102'},{type:'notify',n:330,channel:'Telegram',content:'原帖链接与关注、回复结果'}]}
  ];
  let toastTimer, nextActionN=400, nextAccountN=500, nextPromptN=600, nextWorkflowN=650, nextPromptId=106;
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3200)}
  function navigate(page){page=({mappings:'accounts',monitors:'workflows',outreach:'workflows'}[page]||page);if(!$('#page-'+page))page='accounts';state.page=page;$$('.page').forEach(el=>el.hidden=el.id!=='page-'+page);$$('[data-page]').forEach(el=>{el.classList.toggle('active',el.dataset.page===page);if(el.dataset.page===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')});history.replaceState(null,'','#'+page);window.scrollTo(0,0)}
  function updateMode(online){
    state.online=online;
    $('#onlineButton').classList.toggle('active',online);$('#offlineButton').classList.toggle('active',!online);
    $('#onlineButton').setAttribute('aria-pressed',String(online));$('#offlineButton').setAttribute('aria-pressed',String(!online));
    $('#headerStatus').textContent=online?'服务在线':'服务离线';$('#headerStatus').classList.toggle('off',!online);
    $$('.server-fieldset').forEach(el=>el.disabled=!online);$$('[data-server-offline]').forEach(el=>el.hidden=online);
    $$('.page:not(#page-basic)>.page-head button:not([data-go])').forEach(el=>el.disabled=!online);
    $('#translationPromptId').disabled=!online;$('#aiTranslateOption').disabled=!online;
    if(!online&&$('#editDialog').open)$('#editDialog').close();
  }
  function promptOptions(selected,allowBlank=false){return (allowBlank?'<option value="">请选择 Prompt</option>':'')+prompts.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}
  function accountOptions(selected){return accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)} · ${esc(a.handle)}</option>`).join('')}
  function cachePrompt(id,announce=true){
    if(!id){state.cache=null;try{localStorage.removeItem(CACHE_KEY)}catch{};renderPromptOptions();return true}
    const p=prompts.find(p=>p.id===id);if(!p)return false;
    state.cache={id:p.id,name:p.name,content:p.text,cachedAt:new Date().toISOString()};
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(state.cache));$('#promptCacheStatus').textContent='已缓存到浏览器';$('#promptCacheStatus').className='badge green'}catch{$('#promptCacheStatus').textContent='当前预览已缓存';$('#promptCacheStatus').className='badge amber'}
    if(announce)toast('已缓存所选 Prompt 的内容；这是静态预览缓存。');
    return true;
  }
  function renderPromptOptions(){
    const selected=state.cache?.id||'';$('#translationPromptId').innerHTML=promptOptions(selected,true);
    if(selected&&!prompts.some(p=>p.id===selected)){const option=document.createElement('option');option.value=selected;option.textContent=state.cache.name+'（已缓存）';$('#translationPromptId').append(option)}
    $('#translationPromptId').value=selected;
    $('#promptCacheStatus').textContent=state.cache?'已缓存到浏览器':'未选择 Prompt';$('#promptCacheStatus').className='badge'+(state.cache?' green':'');
  }
  function getBasic(){return {basic:{autoTranslate:$('#autoTranslate').checked,translateProvider:$('#translationProvider').value,targetLang:$('#targetLanguage').value},translationService:{deeplApiType:$('#deeplType').value,fallbackDurationMinutes:Number($('#fallbackMinutes').value),promptId:state.cache?.id||''}}}
  function applyBasic(c){
    if(typeof c.basic?.autoTranslate!=='boolean'||!['auto','google','deepl','ai'].includes(c.basic?.translateProvider)||!['zh-CN','en'].includes(c.basic?.targetLang)||!['free','pro'].includes(c.translationService?.deeplApiType)||!Number.isFinite(c.translationService?.fallbackDurationMinutes)||c.translationService.fallbackDurationMinutes<1||typeof c.translationService?.promptId!=='string')throw Error('请检查配置字段和取值。');
    const id=c.translationService.promptId;
    if(id!==(state.cache?.id||'')){if(!state.online)throw Error('服务离线时不能更换 Prompt。');if(id&&!prompts.some(p=>p.id===id))throw Error('关联的 Prompt 不存在。');cachePrompt(id,false);renderPromptOptions()}
    $('#autoTranslate').checked=c.basic.autoTranslate;$('#translationProvider').value=c.basic.translateProvider;$('#targetLanguage').value=c.basic.targetLang;$('#deeplType').value=c.translationService.deeplApiType;$('#fallbackMinutes').value=c.translationService.fallbackDurationMinutes;
  }
  function applyJson(){try{applyBasic(JSON.parse($('#jsonEditor').value));$('#jsonError').hidden=true;return true}catch(e){$('#jsonError').textContent='配置格式有误：'+e.message;$('#jsonError').hidden=false;return false}}
  function dirtyBasic(){$('#basicSaveState').textContent='有未保存修改';$('#basicSaveState').classList.add('dirty')}
  function setEditMode(mode){if(mode==='form'&&state.editMode==='json'&&!applyJson())return;if(mode==='json')$('#jsonEditor').value=JSON.stringify(getBasic(),null,2);state.editMode=mode;$('#basicForm').hidden=mode!=='form';$('#basicJson').hidden=mode!=='json';$('#formTab').classList.toggle('active',mode==='form');$('#jsonTab').classList.toggle('active',mode==='json');$('#formTab').setAttribute('aria-pressed',String(mode==='form'));$('#jsonTab').setAttribute('aria-pressed',String(mode==='json'))}

  function renderAccounts(){
    $('#accountNavCount').textContent=accounts.length;$('#accountListCount').textContent=accounts.length+' 个账号';
    $('#accountRows').innerHTML=accounts.map((a,i)=>`<tr><td><div class="row"><span class="avatar ${i%2?'sand':''}">${i%2?'中':'EN'}</span><div><span class="config-name">${esc(a.name)}</span><div class="config-detail">${esc(a.handle)}</div></div></div></td><td>${esc(a.platform)}</td><td><span class="badge ${a.cookieConfigured?'green':'amber'}">${a.cookieConfigured?'已配置':'未配置'}</span></td><td class="right"><button class="button small" data-edit-account="${esc(a.id)}" data-n="${a.editN}">编辑</button></td></tr>`).join('');
  }
  function associatedNames(id){return accounts.filter(a=>a.configs.includes(id)).map(a=>a.name)}
  function renderPromptList(){
    const visible=prompts.filter(p=>state.filter==='all'||p.scene===state.filter);
    $('#promptList').innerHTML=visible.map(p=>`<button class="prompt-item ${state.prompt===p.id?'selected':''}" data-prompt="${esc(p.id)}"><div class="prompt-line"><span data-n="${p.n}">${esc(p.name)}</span><span class="badge">${labels[p.scene]}</span></div><div class="prompt-meta">${associatedNames(p.id).length?'已选 '+associatedNames(p.id).length+' 个账号':'未选择账号'}</div></button>`).join('')||'<p class="empty-small">暂无此类模板</p>';
    $('#promptCount').textContent=visible.length+' 个模板';$('#promptNavCount').textContent=prompts.length;
  }
  function promptAccountChoices(selected,creating=false){return accounts.map((a,i)=>`<label class="prompt-account-choice"><input type="checkbox" name="promptAccounts" value="${esc(a.id)}" ${selected.includes(a.id)?'checked':''}><span><span data-n="${(creating?234:221)+i}">${esc(a.name)}</span><small>${esc(a.handle)}</small></span></label>`).join('')||'<span class="help">暂无账号</span>'}
  function setPromptAccounts(id,selected){accounts.forEach(a=>{const ids=a.configs.filter(value=>value!==id);if(selected.includes(a.id))ids.push(id);a.configs=ids})}
  function selectPrompt(id){const p=prompts.find(p=>p.id===id);if(!p)return;state.prompt=id;$('#promptName').value=p.name;$('#promptScene').value=p.scene;$('#promptContent').value=p.text;const names=associatedNames(id);$('#promptAssociation').textContent=id===state.cache?.id?'翻译正在使用':names.length?'已选 '+names.length+' 个账号':'未选择账号';$('#promptAccounts').innerHTML=promptAccountChoices(accounts.filter(a=>a.configs.includes(id)).map(a=>a.id));renderPromptList()}
  function filterPrompts(filter){state.filter=filter;$$('[data-prompt-filter]').forEach(el=>{el.classList.toggle('active',el.dataset.promptFilter===filter);el.setAttribute('aria-pressed',String(el.dataset.promptFilter===filter))});const current=prompts.find(p=>p.id===state.prompt);if(filter!=='all'&&current?.scene!==filter){const first=prompts.find(p=>p.scene===filter);if(first)selectPrompt(first.id)}renderPromptList()}
  function accountDialog(id=null){
    if(!state.online)return;
    const account=accounts.find(a=>a.id===id);state.dialog='account';state.accountId=id;
    $('#dialogTitle').textContent=account?'编辑账号':'添加账号';$('#editDialog').classList.add('account-dialog');
    const choices=[{id:'auto-translate',name:'自动翻译',detail:'使用插件设置中的翻译参数'},...prompts.map(p=>({id:p.id,name:p.name,detail:labels[p.scene]}))];
    $('#dialogContent').innerHTML=`<div class="fields"><label class="field"><span data-n="200">账号名称</span><input name="accountName" value="${esc(account?.name||'')}" placeholder="例如：海外交流" required></label><label class="field"><span data-n="201">平台</span><select name="platform"><option>X / Twitter</option></select></label><label class="field full"><span data-n="202">账号用户名</span><input name="accountHandle" value="${esc(account?.handle||'')}" placeholder="@username" required></label><label class="field full"><span data-n="203">Cookie</span><textarea name="accountCookie" rows="2" class="cookie-input" autocomplete="off" placeholder="${account?.cookieConfigured?'已配置；留空保留当前 Cookie':'粘贴该账号的完整 Cookie'}" ${account?.cookieConfigured?'':'required'}></textarea></label></div><div class="dialog-section"><h3 data-n="204">可选配置</h3><div class="config-choices">${choices.map((p,i)=>`<label class="config-choice"><input type="checkbox" name="configs" value="${esc(p.id)}" ${(account?.configs||[]).includes(p.id)?'checked':''}><span><span class="config-choice-name" data-n="${205+i}">${esc(p.name)}</span><small>${esc(p.detail)}</small></span></label>`).join('')}</div></div>`;
    $('#editDialog').showModal();
  }
  const dialogTemplates={
    ai:{title:'编辑 AI 服务',body:'<div class="fields"><label class="field"><span data-n="142">服务名称</span><input value="我的 AI 服务"></label><label class="field"><span data-n="143">接口格式</span><select><option>OpenAI 兼容</option><option>Anthropic 兼容</option></select></label><label class="field full"><span data-n="144">API 地址</span><input placeholder="https://your-api.example/v1/chat/completions"></label><label class="field full"><span data-n="145">API Key</span><input type="password" autocomplete="off" placeholder="输入 API Key"></label><label class="field full"><span data-n="146">模型列表</span><textarea rows="2">default-model\nfast-model</textarea></label></div>'},
    prompt:{title:'新建互动模板',body:'<div class="fields"><label class="field"><span data-n="230">模板名称</span><input name="newPromptName" placeholder="例如：通用追问" required></label><label class="field"><span data-n="231">使用场景</span><select name="newPromptScene"><option value="post">发帖</option><option value="reply">回复</option></select></label><label class="field full"><span data-n="232">Prompt 内容</span><textarea name="newPromptContent" rows="4" placeholder="输入 Prompt 内容" required></textarea></label></div>'}
  };
  function openDialog(type){if(!state.online)return;state.dialog=type;$('#editDialog').classList.remove('account-dialog');$('#dialogTitle').textContent=dialogTemplates[type].title;$('#dialogContent').innerHTML=dialogTemplates[type].body;if(type==='prompt')$('#dialogContent').insertAdjacentHTML('beforeend','<div class="dialog-section"><h3 data-n="233">适用账号</h3><div class="prompt-account-choices">'+promptAccountChoices([],true)+'</div></div>');$('#editDialog').showModal()}

  function sourceName(w){return w.source==='home'?'账号首页':w.source==='users'?'多个用户':'指定用户'}
  function renderWorkflows(){
    $('#workflowCount').textContent=workflows.length+' 个编排';
    $('#workflowRows').innerHTML=workflows.map(w=>`<tr><td><div class="config-name">${esc(w.name)}</div><div class="config-detail">${esc(accounts.find(a=>a.id===w.account)?.name||'未选择账号')} · 每 ${w.interval} 分钟</div></td><td><span>${sourceName(w)}</span><div class="config-detail">${w.source==='home'?'首页中不同用户的 Post':esc(w.targets)}</div></td><td><div class="action-chain">${w.actions.map((a,i)=>`${i?'<span class="chain-arrow">→</span>':''}<span class="badge ${a.type==='notify'?'':'blue'}">${actionLabels[a.type]}</span>`).join('')}</div></td><td><label class="switch" data-n="${w.toggleN}"><input type="checkbox" ${w.enabled?'checked':''} data-workflow-enabled="${esc(w.id)}" aria-label="启用${esc(w.name)}"></label></td><td class="right"><button class="button small" data-n="${w.editN}" data-edit-workflow="${esc(w.id)}">编辑</button></td></tr>`).join('');
  }
  function updateSourceFields(){const source=$('#workflowSource').value;$('#workflowTargetsField').hidden=source==='home';$('#homeSourceHelp').hidden=source!=='home';$('#workflowTargetsLabel').textContent=source==='users'?'目标用户列表':'目标用户名';$('#workflowTargets').placeholder=source==='users'?'@user_one, @user_two':'@demo_creator'}
  function openWorkflow(id){if(!state.online)return;const existing=workflows.find(w=>w.id===id);state.workflow=existing?structuredClone(existing):{id:null,name:'',account:accounts[0]?.id||'',interval:15,source:'user',targets:'',condition:'',enabled:false,actions:[{type:'notify',n:nextActionN,channel:'Telegram',content:'原帖链接、内容摘要与命中原因'}]};if(!existing)nextActionN+=10;const w=state.workflow;$('#workflowName').value=w.name;$('#workflowAccount').innerHTML=accountOptions(w.account);$('#workflowInterval').value=w.interval;$('#workflowSource').value=w.source;$('#workflowTargets').value=w.targets;$('#workflowCondition').value=w.condition;$('#workflowEnabled').checked=w.enabled;$('#workflowList').hidden=true;$('#workflowEditor').hidden=false;$('#newWorkflow').hidden=true;updateSourceFields();renderActions();window.scrollTo(0,0)}
  function closeWorkflow(){$('#workflowEditor').hidden=true;$('#workflowList').hidden=false;$('#newWorkflow').hidden=false;state.workflow=null;renderWorkflows();window.scrollTo(0,0)}
  function renderActions(){
    const actions=state.workflow.actions;
    $('#workflowActions').innerHTML=actions.map((a,i)=>{
      let fields='';
      if(a.type==='follow')fields='<p class="help">关注命中 Post 的作者。</p>';
      if(a.type==='notify')fields=`<div class="fields"><label class="field"><span data-n="${a.n+4}">通知渠道</span><select data-action-field="channel"><option>Telegram</option></select></label><label class="field"><span data-n="${a.n+5}">通知内容</span><input data-action-field="content" value="${esc(a.content)}"></label></div>`;
      if(a.type==='reply')fields=`<div class="fields"><label class="field"><span data-n="${a.n+4}">回复方式</span><select data-action-field="mode"><option value="text" ${a.mode==='text'?'selected':''}>固定内容</option><option value="prompt" ${a.mode==='prompt'?'selected':''}>使用 Prompt 生成</option></select></label>${a.mode==='prompt'?`<label class="field"><span data-n="${a.n+5}">回复 Prompt</span><select data-action-field="promptId">${promptOptions(a.promptId)}</select></label>`:`<label class="field"><span data-n="${a.n+6}">回复内容</span><input data-action-field="text" value="${esc(a.text)}" placeholder="输入回复正文"></label>`}</div>`;
      return `<div class="action-row" data-action-index="${i}"><div class="action-row-head"><div class="row"><span class="action-order">${i+1}</span><strong data-n="${a.n}">${actionLabels[a.type]}</strong></div><div class="toolbar"><button class="button quiet small" data-n="${a.n+1}" data-action-move="up" aria-label="上移动作 ${i+1}" ${i===0?'disabled':''}>↑</button><button class="button quiet small" data-n="${a.n+2}" data-action-move="down" aria-label="下移动作 ${i+1}" ${i===actions.length-1?'disabled':''}>↓</button><button class="button quiet small danger" data-n="${a.n+3}" data-action-remove aria-label="删除动作 ${i+1}">移除</button></div></div>${fields}</div>`;
    }).join('')||'<p class="empty-small">添加一个动作，决定命中后做什么。</p>';
  }
  function saveWorkflow(){const w=state.workflow;const name=$('#workflowName').value.trim(),condition=$('#workflowCondition').value.trim(),interval=Number($('#workflowInterval').value),source=$('#workflowSource').value,targets=$('#workflowTargets').value.trim(),account=$('#workflowAccount').value;if(!name||!condition||!account||!Number.isFinite(interval)||interval<1||(source!=='home'&&!targets)||!w.actions.length){toast('请填写名称、账号、监听范围、判断条件与至少一个动作。');return}if(w.actions.some(a=>a.type==='reply'&&(a.mode==='text'?!a.text?.trim():!a.promptId))){toast('请填写回复内容或选择回复 Prompt。');return}Object.assign(w,{name,condition,interval,source,targets,account,enabled:$('#workflowEnabled').checked});if(w.id){const index=workflows.findIndex(x=>x.id===w.id);workflows[index]=structuredClone(w)}else{w.id='wf-'+Date.now();w.toggleN=nextWorkflowN++;w.editN=nextWorkflowN++;workflows.push(structuredClone(w))}closeWorkflow();toast('编排已在本次预览中保存；不会运行任何真实动作。')}

  document.addEventListener('click',e=>{
    const page=e.target.closest('[data-page]');if(page)navigate(page.dataset.page);
    const go=e.target.closest('[data-go]');if(go)navigate(go.dataset.go);
    const demo=e.target.closest('[data-demo]');if(demo)toast(demo.dataset.demo+'：静态预览，不发送请求。');
    const dialog=e.target.closest('[data-dialog]');if(dialog)openDialog(dialog.dataset.dialog);
    const account=e.target.closest('[data-edit-account]');if(account)accountDialog(account.dataset.editAccount);
    const prompt=e.target.closest('[data-prompt]');if(prompt)selectPrompt(prompt.dataset.prompt);
    const filter=e.target.closest('[data-prompt-filter]');if(filter)filterPrompts(filter.dataset.promptFilter);
    const workflow=e.target.closest('[data-edit-workflow]');if(workflow)openWorkflow(workflow.dataset.editWorkflow);
    const move=e.target.closest('[data-action-move]');if(move){const i=Number(move.closest('[data-action-index]').dataset.actionIndex),j=i+(move.dataset.actionMove==='up'?-1:1);if(j>=0&&j<state.workflow.actions.length){[state.workflow.actions[i],state.workflow.actions[j]]=[state.workflow.actions[j],state.workflow.actions[i]];renderActions()}}
    const remove=e.target.closest('[data-action-remove]');if(remove){state.workflow.actions.splice(Number(remove.closest('[data-action-index]').dataset.actionIndex),1);renderActions()}
  });
  document.addEventListener('change',e=>{if(e.target.matches('[data-workflow-enabled]')){workflows.find(w=>w.id===e.target.dataset.workflowEnabled).enabled=e.target.checked;toast('仅更新预览状态，不会启动真实任务。')}if(e.target.matches('[data-action-field]')){const a=state.workflow.actions[Number(e.target.closest('[data-action-index]').dataset.actionIndex)];a[e.target.dataset.actionField]=e.target.value;if(e.target.dataset.actionField==='mode')renderActions()}});
  $('#onlineButton').onclick=()=>updateMode(true);$('#offlineButton').onclick=()=>updateMode(false);$('#numberToggle').onchange=e=>document.body.classList.toggle('numbers-hidden',!e.target.checked);$('#refreshButton').onclick=()=>toast('使用顶部切换器预览服务状态；本页未连接真实服务。');
  $('#translationPromptId').onchange=e=>{cachePrompt(e.target.value);dirtyBasic()};$('#page-basic').addEventListener('input',dirtyBasic);
  $('#formTab').onclick=()=>setEditMode('form');$('#jsonTab').onclick=()=>setEditMode('json');$('#formatJson').onclick=()=>{try{$('#jsonEditor').value=JSON.stringify(JSON.parse($('#jsonEditor').value),null,2);$('#jsonError').hidden=true}catch(e){$('#jsonError').textContent='JSON 格式有误：'+e.message;$('#jsonError').hidden=false}};
  $('#saveBasic').onclick=()=>{if(state.editMode==='json'&&!applyJson())return;if(!Number.isFinite(Number($('#fallbackMinutes').value))||Number($('#fallbackMinutes').value)<1){toast('备用时长至少为 1 分钟。');return}try{localStorage.setItem(BASIC_KEY,JSON.stringify(getBasic()))}catch{};$('#basicSaveState').textContent='预览修改已保存';$('#basicSaveState').classList.remove('dirty');toast('已保存预览设置；未修改真实插件配置。')};
  $('#addAccount').onclick=()=>accountDialog();$('#newPrompt').onclick=()=>openDialog('prompt');$('#closeDialog').onclick=()=>$('#editDialog').close();$('#cancelDialog').onclick=()=>$('#editDialog').close();$('#editDialog').addEventListener('close',()=>{$('#dialogContent').innerHTML='';$('#editDialog').classList.remove('account-dialog')});
  $('#dialogForm').onsubmit=e=>{e.preventDefault();const data=new FormData(e.target);if(state.dialog==='account'){
      let a=accounts.find(a=>a.id===state.accountId);let handle=String(data.get('accountHandle')).trim();if(!handle.startsWith('@'))handle='@'+handle;
      if(accounts.some(other=>other.id!==state.accountId&&other.handle.toLowerCase()===handle.toLowerCase())){toast('该账号已存在。');return}
      if(!a){a={id:'account-'+Date.now(),cookieConfigured:false,editN:nextAccountN++};accounts.push(a)}
      Object.assign(a,{name:String(data.get('accountName')).trim(),handle,platform:String(data.get('platform')),cookieConfigured:a.cookieConfigured||Boolean(String(data.get('accountCookie')).trim()),configs:data.getAll('configs')});
      renderAccounts();selectPrompt(state.prompt);renderWorkflows();toast('账号与所选配置已更新到本次预览；Cookie 不会发送或持久化。');
    }else if(state.dialog==='prompt'){
      const p={id:String(nextPromptId++),n:nextPromptN++,name:String(data.get('newPromptName')).trim(),scene:String(data.get('newPromptScene')),text:String(data.get('newPromptContent')).trim()};prompts.push(p);setPromptAccounts(p.id,data.getAll('promptAccounts'));filterPrompts('all');selectPrompt(p.id);renderPromptOptions();toast('模板和适用账号已加入预览。');
    }else toast('已完成弹窗预览，未保存真实服务配置。');$('#editDialog').close();};
  $('#savePrompt').onclick=()=>{const name=$('#promptName').value.trim(),text=$('#promptContent').value.trim();if(!name||!text){toast('请填写模板名称和内容。');return}Object.assign(prompts.find(p=>p.id===state.prompt),{name,scene:$('#promptScene').value,text});setPromptAccounts(state.prompt,$$('#promptAccounts input:checked').map(el=>el.value));if(state.cache?.id===state.prompt)cachePrompt(state.prompt,false);renderPromptOptions();filterPrompts(state.filter);selectPrompt(state.prompt);toast('模板与适用账号已更新到本次预览。')};
  $('#newWorkflow').onclick=()=>openWorkflow();$('#backToWorkflows').onclick=closeWorkflow;$('#cancelWorkflow').onclick=closeWorkflow;$('#workflowSource').onchange=updateSourceFields;$('#saveWorkflow').onclick=saveWorkflow;
  $('#addAction').onclick=()=>{const type=$('#actionToAdd').value;state.workflow.actions.push({type,n:nextActionN,mode:'text',text:'',promptId:'102',channel:'Telegram',content:'原帖链接与执行结果'});nextActionN+=10;renderActions()};
  window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
  try{const saved=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(saved&&typeof saved.id==='string'&&typeof saved.content==='string'&&typeof saved.name==='string')state.cache=saved}catch{}
  if(!state.cache)cachePrompt('105',false);renderPromptOptions();
  try{const saved=JSON.parse(localStorage.getItem(BASIC_KEY)||'null');if(saved){saved.translationService.promptId=state.cache?.id||'';applyBasic(saved)}}catch{}
  renderAccounts();selectPrompt('105');renderWorkflows();updateMode(true);navigate(location.hash.slice(1)||'accounts');
})();
