import { sharedStyles } from './shared-styles';
import { sharedUi } from './shared-ui';

export const liveUrlBlacklistHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TVBox 直播源正则黑名单</title>
<style>
${sharedStyles}
.container{max-width:1180px}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}
.toolbar .status{font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:4px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
@media(max-width:700px){.stats{grid-template-columns:1fr}}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
.stat-label{font-family:var(--mono);font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em}
.stat-value{font-family:var(--mono);font-size:16px;color:var(--text-bright);margin-top:3px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:12px;margin-top:12px}
.panel h2{font-size:12px;color:var(--text-bright);margin:0 0 10px;letter-spacing:.06em}
.form-grid{display:grid;grid-template-columns:minmax(260px,1fr) 130px minmax(160px,240px) auto;gap:8px;align-items:end}
@media(max-width:850px){.form-grid{grid-template-columns:1fr 1fr}.form-grid .grow{grid-column:1/-1}}
.field label{display:block;color:var(--text-dim);font-size:10px;margin-bottom:4px}
.field input,.field select,.field textarea{width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--surface-2);color:var(--text);border-radius:6px;padding:7px 8px;font-family:var(--mono);font-size:11px;outline:none}
.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--green)}
.field textarea{min-height:78px;resize:vertical}
.form-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rule-list{display:flex;flex-direction:column;gap:6px}
.rule-row{display:grid;grid-template-columns:auto 58px minmax(160px,1fr) minmax(140px,240px) auto;gap:8px;align-items:center;padding:8px 9px;border:1px solid var(--border);border-radius:7px;background:var(--surface-2)}
@media(max-width:850px){.rule-row{grid-template-columns:auto 58px 1fr;}.rule-row .note{grid-column:2/-1}.rule-row .actions{grid-column:2/-1}}
.rule-row.disabled{opacity:.55}
.rule-pattern{font-family:var(--mono);font-size:11px;color:var(--text);word-break:break-all}
.rule-note{font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:4px;background:var(--surface);border:1px solid var(--border);color:var(--text-dim);text-align:center}
.tag.on{color:var(--green);border-color:var(--green-dim);background:var(--green-dim)}
.actions{display:flex;gap:4px;justify-content:flex-end}
.hint{color:var(--text-dim);font-size:10px;line-height:1.65;margin:7px 0 0}
.test-result{white-space:pre-wrap;font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-top:8px;min-height:18px}
.batch-grid{display:grid;grid-template-columns:1fr 130px 220px auto;gap:8px;align-items:end;margin-top:10px}
@media(max-width:850px){.batch-grid{grid-template-columns:1fr}}
</style>
</head>
<body style="opacity:0">

<div class="login-overlay" id="loginOverlay">
  <div class="login-box">
    <h2>直播源正则黑名单</h2>
    <p>请输入管理令牌</p>
    <div class="error-msg" id="loginError">无效的令牌</div>
    <input type="password" id="tokenInput" placeholder="Admin Token" autofocus>
    <button class="btn" style="width:100%" onclick="auth.doLogin()">登录</button>
  </div>
</div>

<div class="container" id="mainContent" style="display:none">
  <header class="header">
    <div class="header-top">
      <div class="header-label">Live URL Filter</div>
      <div style="display:flex;gap:8px;align-items:center"><span id="themeDropdown"></span></div>
    </div>
    <h1 class="header-title">直播 <span>源黑名单</span></h1>
    <div class="header-nav">
      <a href="/admin">管理</a>
      <a href="/admin/config-editor">编辑器</a>
      <a href="/builder">源 Builder</a>
      <a href="/group-builder">直播分组</a>
      <a href="/status">仪表盘</a>
    </div>
  </header>

  <div class="toolbar">
    <button class="btn sm secondary" onclick="loadRules()">刷新列表</button>
    <button class="btn sm secondary" onclick="exportRules()">导出 JSON</button>
    <button class="btn sm ghost" onclick="clearForm()">清空表单</button>
    <span class="status" id="status"></span>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-label">规则总数</div><div class="stat-value" id="statTotal">0</div></div>
    <div class="stat"><div class="stat-label">已启用</div><div class="stat-value" id="statEnabled">0</div></div>
    <div class="stat"><div class="stat-label">已停用</div><div class="stat-value" id="statDisabled">0</div></div>
  </div>

  <div class="panel">
    <h2>新增 / 编辑规则</h2>
    <div class="form-grid">
      <div class="field grow"><label>正则表达式（JavaScript RegExp，i 标志）</label><input id="patternInput" placeholder="例如：^https?://(?:[^/?#]*@)?example\\\\.com(?::\\\\d+)?(?:[/?#]|$)"></div>
      <div class="field"><label>匹配对象</label><select id="fieldSelect"><option value="url">播放地址</option><option value="source">直播源名</option><option value="name">频道名</option><option value="group">原始分组</option></select></div>
      <div class="field"><label>备注（可选）</label><input id="noteInput" maxlength="200" placeholder="例如：上游域名已下线"></div>
      <div class="form-actions"><button class="btn sm" id="saveBtn" onclick="saveRule()">新增规则</button><button class="btn sm ghost" id="cancelEditBtn" style="display:none" onclick="clearForm()">取消</button></div>
    </div>
    <input type="hidden" id="editId">
    <p class="hint">规则只影响直播合并，不修改上游列表；保存后需执行一次 refresh 才会写入最终输出。匹配字段为「播放地址」时，对清洗后的完整 URL 做正则匹配。</p>
  </div>

  <div class="panel">
    <h2>规则列表 <span style="color:var(--text-dim);font-weight:400" id="listCount"></span></h2>
    <div id="ruleList" class="rule-list"><div class="empty">加载中...</div></div>
    <div class="form-actions" style="margin-top:10px">
      <button class="btn sm secondary" onclick="testRule()">用当前合并树测试表单规则</button>
      <span class="test-result" id="testResult"></span>
    </div>
  </div>

  <div class="panel">
    <h2>批量导入</h2>
    <div class="batch-grid">
      <div class="field"><label>每行一个正则；空行和以 # 开头的行忽略</label><textarea id="batchPatterns" placeholder="^https?://(?:[^/?#]*@)?example\\\\.com(?::\\\\d+)?(?:[/?#]|$)"></textarea></div>
      <div class="field"><label>匹配对象</label><select id="batchField"><option value="url">播放地址</option><option value="source">直播源名</option><option value="name">频道名</option><option value="group">原始分组</option></select></div>
      <div class="field"><label>统一备注（可选）</label><input id="batchNote" maxlength="200" placeholder="批量导入"></div>
      <button class="btn sm secondary" onclick="batchImport()">批量追加</button>
    </div>
    <p class="hint">批量追加不会清空现有规则；最多 2000 条。导入前建议先测试一条代表性正则。</p>
  </div>
</div>

<script>
${sharedUi}

var TOKEN = '';
var RULES = [];
var auth = initAuth('tokenInput', 'loginError', 'loginOverlay', 'mainContent', '/admin/live-url-blacklist/rules', function() {
  TOKEN = auth.getToken();
  loadRules();
});

function api(path, opts) {
  opts = opts || {};
  return auth.authFetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(res) {
    if (res.status === 401) { location.reload(); throw new Error('unauthorized'); }
    return res;
  });
}
function setStatus(msg) { document.getElementById('status').textContent = msg || ''; }
function fieldLabel(field) {
  return { url: '播放地址', source: '直播源名', name: '频道名', group: '原始分组' }[field] || field;
}
function render() {
  var enabled = RULES.filter(function(r) { return r.enabled; }).length;
  document.getElementById('statTotal').textContent = RULES.length;
  document.getElementById('statEnabled').textContent = enabled;
  document.getElementById('statDisabled').textContent = RULES.length - enabled;
  document.getElementById('listCount').textContent = '(' + RULES.length + ')';
  var list = document.getElementById('ruleList');
  if (RULES.length === 0) {
    list.innerHTML = '<div class="empty">还没有规则。可在上方新增，或在下方批量导入。</div>';
    return;
  }
  list.innerHTML = RULES.map(function(r) {
    var id = esc(r.id);
    return '<div class="rule-row' + (r.enabled ? '' : ' disabled') + '">' +
      '<input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' onchange="toggleRule(\\'' + id + '\\',this.checked)" title="启用/停用">' +
      '<span class="tag ' + (r.enabled ? 'on' : '') + '">' + esc(fieldLabel(r.field)) + '</span>' +
      '<code class="rule-pattern">' + esc(r.pattern) + '</code>' +
      '<span class="rule-note" title="' + esc(r.note || '') + '">' + esc(r.note || '') + '</span>' +
      '<span class="actions"><button class="btn sm ghost" onclick="editRule(\\'' + id + '\\')">编辑</button><button class="btn sm danger" onclick="deleteRule(\\'' + id + '\\')">删除</button></span>' +
      '</div>';
  }).join('');
}
async function loadRules() {
  setStatus('加载中...');
  try {
    var res = await api('/admin/live-url-blacklist/rules');
    var data = await res.json();
    if (!res.ok) { setStatus('加载失败: ' + (data.error || res.status)); return; }
    RULES = data.rules || [];
    render();
    setStatus('已加载 ' + RULES.length + ' 条规则');
  } catch (e) { setStatus('加载失败: ' + e.message); }
}
function clearForm() {
  document.getElementById('editId').value = '';
  document.getElementById('patternInput').value = '';
  document.getElementById('noteInput').value = '';
  document.getElementById('fieldSelect').value = 'url';
  document.getElementById('saveBtn').textContent = '新增规则';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('testResult').textContent = '';
}
function editRule(id) {
  var rule = RULES.find(function(r) { return r.id === id; });
  if (!rule) return;
  document.getElementById('editId').value = rule.id;
  document.getElementById('patternInput').value = rule.pattern;
  document.getElementById('fieldSelect').value = rule.field;
  document.getElementById('noteInput').value = rule.note || '';
  document.getElementById('saveBtn').textContent = '保存修改';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  document.getElementById('patternInput').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function saveRule() {
  var pattern = document.getElementById('patternInput').value.trim();
  var field = document.getElementById('fieldSelect').value;
  var note = document.getElementById('noteInput').value.trim();
  var id = document.getElementById('editId').value;
  if (!pattern) { setStatus('请输入正则表达式'); return; }
  var body = { pattern: pattern, field: field, note: note, enabled: true };
  try {
    var res = id
      ? await api('/admin/live-url-blacklist/rules/' + encodeURIComponent(id), { method: 'PUT', body: body })
      : await api('/admin/live-url-blacklist/rules', { method: 'POST', body: body });
    var data = await res.json();
    if (!res.ok) { setStatus('保存失败: ' + (data.error || res.status)); return; }
    clearForm();
    await loadRules();
    setStatus('已保存；下一次 refresh 生效');
  } catch (e) { setStatus('保存失败: ' + e.message); }
}
async function toggleRule(id, enabled) {
  try {
    var res = await api('/admin/live-url-blacklist/rules/' + encodeURIComponent(id), { method: 'PUT', body: { enabled: enabled } });
    var data = await res.json();
    if (!res.ok) { setStatus('更新失败: ' + (data.error || res.status)); return; }
    await loadRules();
  } catch (e) { setStatus('更新失败: ' + e.message); }
}
async function deleteRule(id) {
  if (!confirm('删除这条规则？')) return;
  try {
    var res = await api('/admin/live-url-blacklist/rules/' + encodeURIComponent(id), { method: 'DELETE' });
    var data = await res.json();
    if (!res.ok) { setStatus('删除失败: ' + (data.error || res.status)); return; }
    await loadRules();
    setStatus('已删除');
  } catch (e) { setStatus('删除失败: ' + e.message); }
}
async function testRule() {
  var pattern = document.getElementById('patternInput').value.trim();
  var field = document.getElementById('fieldSelect').value;
  var el = document.getElementById('testResult');
  if (!pattern) { el.textContent = '请输入正则表达式'; return; }
  el.textContent = '测试中...';
  try {
    var res = await api('/admin/live-url-blacklist/test', { method: 'POST', body: { pattern: pattern, field: field } });
    var data = await res.json();
    if (!res.ok) { el.textContent = '测试失败: ' + (data.error || res.status); return; }
    if (!data.matched) { el.textContent = '当前合并树没有匹配项'; return; }
    el.textContent = '匹配 ' + data.matched + ' 项' + (data.sample && data.sample.length ? '：' + data.sample.map(function(x) { return x.group + '/' + x.name + (x.host ? ' (' + x.host + ')' : ''); }).join('，') : '');
  } catch (e) { el.textContent = '测试失败: ' + e.message; }
}
async function batchImport() {
  var lines = document.getElementById('batchPatterns').value.split(/\\r?\\n/).map(function(x) { return x.trim(); }).filter(function(x) { return x && x.charAt(0) !== '#'; });
  var field = document.getElementById('batchField').value;
  var note = document.getElementById('batchNote').value.trim();
  if (lines.length === 0) { setStatus('没有可导入的正则'); return; }
  var rules = lines.map(function(pattern) { return { pattern: pattern, field: field, note: note, enabled: true }; });
  try {
    var res = await api('/admin/live-url-blacklist/batch', { method: 'POST', body: { rules: rules } });
    var data = await res.json();
    if (!res.ok) { setStatus('批量导入失败: ' + (data.error || res.status)); return; }
    document.getElementById('batchPatterns').value = '';
    await loadRules();
    setStatus('已追加 ' + data.added + ' 条规则；下一次 refresh 生效');
  } catch (e) { setStatus('批量导入失败: ' + e.message); }
}
function exportRules() {
  var blob = new Blob([JSON.stringify({ version: 1, kind: 'tvbox-live-url-blacklist', rules: RULES }, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'live-url-blacklist.json';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}
applyTheme(getTheme());
initThemeDropdown();
document.body.style.opacity = '1';
</script>
</body>
</html>`;
