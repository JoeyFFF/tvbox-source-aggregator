import { sharedStyles } from './shared-styles';
import { sharedUi } from './shared-ui';

export const liveGroupBuilderHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TVBox 直播分组 Builder</title>
<style>
${sharedStyles}

.container{max-width:1600px}
.workspace{display:grid;grid-template-columns:280px 310px 300px minmax(320px,1fr);gap:10px;margin-top:14px;height:calc(100vh - 190px);min-height:560px}
@media(max-width:1500px){.workspace{grid-template-columns:240px 270px 270px minmax(280px,1fr)}}
@media(max-width:1100px){.workspace{grid-template-columns:1fr;height:auto}.pane{max-height:75vh}}
.pane{background:var(--surface);border:1px solid var(--border);border-radius:9px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.pane-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.pane-head .dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green)}
.pane-head h2{font-size:11px;margin:0;color:var(--text-bright);letter-spacing:.07em;text-transform:uppercase;font-weight:600}
.pane-head .count{color:var(--text-dim);font-size:10px;margin-left:auto}
.pane-body{flex:1;min-height:0;overflow:auto;padding:8px}
.pane-body::-webkit-scrollbar{width:8px;height:8px}
.pane-body::-webkit-scrollbar-thumb{background:var(--border-glow);border-radius:8px}
.search{width:100%;border:1px solid var(--border);background:var(--surface-2);color:var(--text);border-radius:6px;padding:6px 8px;font-size:11px;outline:none;margin-bottom:8px}
.search:focus{border-color:var(--border-glow)}
.toolbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:14px}
.toolbar .status{font-family:var(--mono);font-size:10px;color:var(--text-dim);margin-left:4px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
.stat-label{font-family:var(--mono);font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em}
.stat-value{font-family:var(--mono);font-size:15px;color:var(--text-bright);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-group{border:1px solid transparent;border-radius:7px;margin-bottom:2px}
.tree-group.open{border-color:var(--border);background:var(--surface-2)}
.group-row{display:flex;align-items:center;gap:6px;padding:6px 7px;border-radius:6px;cursor:pointer}
.group-row:hover{background:var(--surface-2)}
.group-row.active{background:var(--surface-2);box-shadow:inset 2px 0 0 var(--green)}
.caret{width:11px;color:var(--text-dim);font-size:9px;flex-shrink:0;transition:transform .15s}
.tree-group.open .caret,.target-group.open .caret{transform:rotate(90deg)}
.g-name{color:var(--text-bright);font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.g-count{color:var(--text-dim);font-size:10px}
.g-targets{display:flex;flex-wrap:wrap;gap:3px;margin:0 0 5px 18px}
.chip{display:inline-flex;gap:4px;align-items:center;padding:1px 6px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);font-size:9px}
.chip b{font-weight:500;color:var(--text)}
.chip.red{border-color:var(--red-dim);color:var(--red);background:var(--red-dim)}
.ch-chip{border-color:var(--blue-dim);color:var(--blue);background:var(--blue-dim)}
.ch-list{margin:0 0 5px 18px;border-left:1px solid var(--border);padding-left:5px}
.ch-row{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:4px;cursor:pointer;color:var(--text);font-size:10px;white-space:nowrap;overflow:hidden}
.ch-row:hover{background:var(--surface-2);color:var(--text-bright)}
.ch-row.active{background:var(--green-dim);color:var(--green)}
.ch-row .arrow{margin-left:auto;color:var(--text-dim);font-size:9px;opacity:0}
.ch-row:hover .arrow{opacity:1}
.more{color:var(--text-dim);font-size:9px;padding:3px 5px;cursor:pointer}
.more:hover{color:var(--green)}
.section-label{display:flex;align-items:center;gap:7px;color:var(--text-dim);font-size:9px;text-transform:uppercase;letter-spacing:.1em;margin:10px 0 6px}
.section-label:after{content:"";height:1px;background:var(--border);flex:1}
.section-label button{padding:2px 7px;font-size:9px}
.rule-list{display:flex;flex-direction:column;gap:4px}
.rule-card{border:1px solid var(--border);border-radius:7px;padding:6px 7px;cursor:grab;background:var(--surface-2);transition:.15s}
.rule-card:hover{border-color:var(--border-glow)}
.rule-card.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green-dim)}
.rule-card.dragging{opacity:.4;border-style:dashed}
.rule-card.disabled{opacity:.55}
.rule-top{display:flex;align-items:center;gap:5px}
.drag-handle{color:var(--text-dim);font-size:10px;letter-spacing:-2px;cursor:grab}
.rule-order{min-width:16px;height:16px;border-radius:4px;background:var(--surface-2);color:var(--text-dim);font-size:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.rule-card.active .rule-order{background:var(--green-dim);color:var(--green)}
.rule-name{color:var(--text-bright);font-size:10px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rule-enable{width:13px;height:13px;accent-color:var(--green);cursor:pointer;flex-shrink:0}
.rule-meta{color:var(--text-dim);font-size:9px;margin-top:2px}
.rule-meta b{color:var(--text);font-weight:500}
.rule-hint{color:var(--text-dim);font-size:9px;margin:-2px 0 5px}
.pure-notice{border:1px solid var(--border);border-radius:7px;padding:7px 9px;margin:2px 0 8px;background:var(--surface-2);color:var(--text);font-size:9px;line-height:1.5}
.match-info{border:1px dashed var(--border-glow);border-radius:6px;padding:5px 7px;font-size:9px;color:var(--text-dim);margin-bottom:6px}
.match-info b{color:var(--green);font-weight:500}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.field{display:flex;flex-direction:column;gap:3px;margin-bottom:6px}
.field.full{grid-column:1/-1}
.field label{color:var(--text-dim);font-size:9px}
.field input,.field select{border:1px solid var(--border);background:var(--surface-2);color:var(--text);border-radius:5px;padding:6px 7px;font-size:10px;outline:none;width:100%}
.field input:focus,.field select:focus{border-color:var(--green)}
.field input[readonly]{color:var(--text-dim);background:var(--surface-2)}
.form-actions{display:flex;gap:6px;flex-wrap:wrap}
.target-group{border:1px solid transparent;border-radius:7px;margin-bottom:2px}
.target-group.open{border-color:var(--border);background:var(--surface-2)}
.target-row{display:flex;align-items:center;gap:6px;padding:6px 7px;border-radius:6px;cursor:pointer}
.target-row:hover{background:var(--surface-2)}
.target-row.active{background:var(--surface-2);box-shadow:inset 2px 0 0 var(--blue)}
.t-name{color:var(--text-bright);font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-count{color:var(--text-dim);font-size:10px}
.t-channels{margin:0 0 5px 18px;border-left:1px solid var(--border);padding-left:5px}
.t-ch{display:flex;align-items:baseline;gap:6px;padding:2px 4px;border-radius:4px;font-size:9px;color:var(--text)}
.t-ch:hover{background:var(--surface-2)}
.t-ch .from{color:var(--text-dim);font-size:9px;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-ch.filtered{color:var(--red)}
.t-ch.filtered .from{color:var(--text-dim)}
.empty{padding:22px 10px;text-align:center;color:var(--text-dim);font-size:10px;line-height:1.7}
.legend{display:flex;gap:9px;color:var(--text-dim);font-size:9px;padding:0 1px 5px;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:3px}
.legend i{width:6px;height:6px;border-radius:2px;display:inline-block}
.sort-box{border:1px solid var(--border);border-radius:7px;padding:7px 8px;margin-bottom:8px;background:var(--surface-2)}
.sort-box .sort-label{color:var(--text-dim);font-size:9px;display:block;margin-bottom:3px}
.sort-box input[type=text]{width:100%;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:5px;padding:5px 7px;font-size:10px;outline:none}
.sort-box input[type=text]:focus{border-color:var(--green)}
.sort-line{display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap}
.sort-line span{color:var(--text-dim);font-size:9px}
.sort-line select{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:5px;padding:4px 6px;font-size:10px}
.sort-line label{display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:9px;cursor:pointer}
.sort-line input[type=checkbox]{accent-color:var(--green);cursor:pointer}
</style>
</head>
<body style="opacity:0">

<div class="login-overlay" id="loginOverlay">
  <div class="login-box">
    <h2>直播分组 Builder</h2>
    <p>请输入管理令牌</p>
    <div class="error-msg" id="loginError">无效的令牌</div>
    <input type="password" id="tokenInput" placeholder="Admin Token" autofocus>
    <button class="btn" style="width:100%" onclick="auth.doLogin()">登录</button>
  </div>
</div>

<div class="container" id="mainContent" style="display:none">
  <header class="header">
    <div class="header-top">
      <div class="header-label">Live Group Builder</div>
      <div style="display:flex;gap:8px;align-items:center"><span id="themeDropdown"></span></div>
    </div>
    <h1 class="header-title">直播 <span>分组</span></h1>
    <div class="header-nav">
      <a href="/admin">管理</a>
      <a href="/config-editor">编辑器</a>
      <a href="/builder">源 Builder</a>
      <a href="/admin/live-url-blacklist">直播源黑名单</a>
      <a href="/status">仪表盘</a>
    </div>
  </header>

  <div class="toolbar">
    <button class="btn sm" onclick="doPreview()">预览</button>
    <button class="btn sm secondary" onclick="saveRules()">保存规则</button>
    <button class="btn sm secondary" onclick="saveAndRefresh()">保存并刷新</button>
    <button class="btn sm secondary" onclick="exportRules()">导出规则</button>
    <button class="btn sm secondary" onclick="document.getElementById('importFile').click()">导入规则</button>
    <button class="btn sm ghost" id="undoImport" style="display:none" onclick="undoImport()">撤销导入</button>
    <input type="file" id="importFile" accept=".json,application/json" style="display:none" onchange="importRules(this)">
    <span class="status" id="status"></span>
  </div>

  <div class="stats" id="stats"></div>

  <div class="workspace">
    <section class="pane">
      <div class="pane-head"><span class="dot"></span><h2>源分组 / 频道</h2><span class="count" id="srcCount"></span></div>
      <div class="pane-body">
        <input class="search" id="srcSearch" placeholder="搜索源组或频道..." oninput="renderSources()">
        <div class="legend"><span><i style="background:var(--blue)"></i>源组</span><span><i style="background:var(--text-dim)"></i><span id="srcTargetLegend">上次合并目标</span></span><span>点频道 → 填入规则</span></div>
        <div id="srcTree"><div class="empty">加载中...</div></div>
      </div>
    </section>

    <section class="pane">
      <div class="pane-head"><span class="dot"></span><h2>规则列表</h2><span class="count" id="ruleCount"></span></div>
      <div class="pane-body">
        <div id="pureCustomNotice" class="pure-notice">纯自定义模式：整组过滤已作为首条自定义规则，按列表顺序匹配。</div>
        <div class="section-label">自定义规则 <button class="btn sm ghost" onclick="newRule()">+ 新建</button></div>
        <div class="rule-hint">拖拽调整顺序，越靠上越先匹配；右侧 checkbox 控制启用</div>
        <div class="rule-list" id="ruleList"></div>
      </div>
    </section>

    <section class="pane">
      <div class="pane-head"><span class="dot" style="background:var(--amber);box-shadow:0 0 10px var(--amber)"></span><h2>规则详情</h2><span class="count" id="detailState"></span></div>
      <div class="pane-body">
        <div class="match-info" id="matchInfo">选择左侧频道，或点击规则列表中的一条规则</div>
        <div class="field"><label>源分组正则 groupPattern</label><input id="fGroup" placeholder="例如 ^浙江$" oninput="updateMatchInfo()"></div>
        <div class="field"><label>频道正则 channelPattern（可选）</label><input id="fChannel" placeholder="例如 ^浙江遂昌$" oninput="updateMatchInfo()"></div>
        <div class="field"><label>目标分组</label>
          <select id="fTarget" onchange="onTargetChange()">
            <option value="__default__">默认（原组）</option>
            <option value="央视">央视</option>
            <option value="卫视">卫视</option>
            <option value="地方台">地方台</option>
            <option value="其他境内">其他境内</option>
            <option value="境内电视台">境内电视台</option>
            <option value="一起看">一起看</option>
            <option value="轮播台">轮播台</option>
            <option value="__filter__">过滤（不输出）</option>
            <option value="__custom__">自定义...</option>
          </select>
          <input id="fTargetCustom" placeholder="输入自定义目标分组" style="display:none;margin-top:4px">
        </div>
        <div class="field"><label>频道名前缀</label>
          <select id="fPrefix"><option value="">不加前缀</option><option value="province">按源组省份</option></select>
        </div>
        <div class="field"><label>匹配顺序</label><input id="fOrder" readonly value="—"></div>
        <div class="form-actions">
          <button class="btn sm primary" onclick="saveRuleDraft()">保存到草稿</button>
          <button class="btn sm ghost" onclick="clearForm()">清空</button>
          <button class="btn sm danger" onclick="deleteSelectedRule()">删除规则</button>
        </div>
      </div>
    </section>

    <section class="pane">
      <div class="pane-head"><span class="dot" style="background:var(--blue);box-shadow:0 0 10px var(--blue)"></span><h2>整理分组 / 频道</h2><span class="count" id="targetCount"></span></div>
      <div class="pane-body">
        <div class="sort-box">
          <span class="sort-label">组顺序（逗号分隔；未列出的组排在后面）</span>
          <input type="text" id="groupOrderInput" placeholder="例如：央视,卫视,境内地方,港澳台" oninput="markDirty()">
          <div class="sort-line">
            <span>频道排序</span>
            <select id="channelSortSelect" onchange="markDirty()">
              <option value="default">默认（合并顺序）</option>
              <option value="name">按名称</option>
            </select>
            <label><input type="checkbox" id="failedLastCheck" onchange="markDirty()">失效频道置底</label>
          </div>
        </div>
        <input class="search" id="targetSearch" placeholder="搜索目标组或频道..." oninput="renderPreview()">
        <div class="legend"><span><i style="background:var(--green)"></i>目标组</span><span><i style="background:var(--red)"></i>已过滤</span><span id="previewTime">尚未预览</span></div>
        <div style="color:var(--text-dim);font-size:9px;margin:-2px 0 6px">预览按显示名去重，最终数量以 refresh 为准</div>
        <div id="targetTree"><div class="empty">点「预览」查看整理结果</div></div>
      </div>
    </section>
  </div>
</div>

<script>
${sharedUi}

var TOKEN = '';
var SNAPSHOT = null;
var SNAPSHOT_ERROR = '';
var RULES = [];
var PREVIEW = null;
var PREVIEW_DIRTY = true;
var PREVIEW_AT = 0;
var SELECTED_SOURCE = '';
var EXPANDED_SOURCE = '';
var PICKED_CHANNEL = '';
var SELECTED_RULE = -1;
var DRAG_INDEX = null;
var EXPANDED_TARGET = '';
var SOURCE_LIMIT = 30;
var TARGET_LIMIT = 100;
var LAST_IMPORT_BACKUP = null;
var SORT = { groupOrder: [], channelSort: 'default', failedLast: false };

var auth = initAuth('tokenInput', 'loginError', 'loginOverlay', 'mainContent', '/admin/live-group-rules', function() {
  TOKEN = auth.getToken();
  loadAll();
});

function api(path, opts) {
  opts = opts || {};
  return fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(res) {
    if (res.status === 401) { location.reload(); throw new Error('unauthorized'); }
    return res;
  });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function reEsc(s) {
  var text = String(s || '');
  var special = '\\^$.*+?()[]{}|';
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    out += special.indexOf(c) >= 0 ? String.fromCharCode(92) + c : c;
  }
  return out;
}
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function setStatus(msg) { document.getElementById('status').textContent = msg || ''; }
function markDirty() {
  PREVIEW_DIRTY = true;
  var el = document.getElementById('previewTime');
  if (el) el.textContent = '预览已过期';
}
function syncSortControls() {
  document.getElementById('groupOrderInput').value = (SORT.groupOrder || []).join(',');
  document.getElementById('channelSortSelect').value = SORT.channelSort === 'name' ? 'name' : 'default';
  document.getElementById('failedLastCheck').checked = SORT.failedLast === true;
}
function sortForSave() {
  var raw = document.getElementById('groupOrderInput').value || '';
  var list = raw.split(/[,，\\n]/).map(function(s) { return s.trim(); }).filter(function(s) { return !!s; });
  var order = [];
  list.forEach(function(n) { if (order.indexOf(n) < 0) order.push(n); });
  return {
    groupOrder: order,
    channelSort: document.getElementById('channelSortSelect').value === 'name' ? 'name' : 'default',
    failedLast: document.getElementById('failedLastCheck').checked
  };
}
function targetLabel(t) { return t === '__filter__' ? '已过滤' : t; }
function formatTime(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); } }
function safeRe(pattern) { try { return pattern ? new RegExp(pattern, 'i') : null; } catch (e) { return null; } }
function targetOptions() {
  return Array.from(document.getElementById('fTarget').options).map(function(o) { return o.value; });
}
function setTargetValue(value) {
  var sel = document.getElementById('fTarget');
  var custom = document.getElementById('fTargetCustom');
  var v = value == null ? '__default__' : String(value);
  if (targetOptions().indexOf(v) >= 0) {
    sel.value = v;
    custom.style.display = 'none';
    custom.value = '';
  } else {
    sel.value = '__custom__';
    custom.style.display = 'block';
    custom.value = v;
  }
}
function getTargetValue() {
  var sel = document.getElementById('fTarget');
  if (sel.value === '__custom__') {
    return (document.getElementById('fTargetCustom').value || '').trim();
  }
  return sel.value;
}

async function loadAll() {
  setStatus('加载中...');
  try {
    var rulesRes = await api('/admin/live-group-rules');
    if (!rulesRes.ok) { setStatus('规则加载失败 HTTP ' + rulesRes.status); return; }
    var rs = await rulesRes.json();
    RULES = (rs.rules || []).slice().sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });
    SORT = {
      groupOrder: Array.isArray(rs.groupOrder) ? rs.groupOrder : [],
      channelSort: rs.channelSort === 'name' ? 'name' : 'default',
      failedLast: rs.failedLast === true
    };
    syncSortControls();
    var snapRes = await api('/admin/live-group-snapshot');
    if (snapRes.ok) { SNAPSHOT = await snapRes.json(); SNAPSHOT_ERROR = ''; }
    else { SNAPSHOT = null; var e = await snapRes.json().catch(function() { return {}; }); SNAPSHOT_ERROR = e.error || ('HTTP ' + snapRes.status); }
    PREVIEW = null;
    PREVIEW_DIRTY = false;
    PREVIEW_AT = 0;
    SELECTED_RULE = -1;
    renderAll();
    if (RULES.length > 0) selectRule(0); else newRule();
    setStatus(SNAPSHOT ? '已加载快照 ' + formatTime(SNAPSHOT.updatedAt) : SNAPSHOT_ERROR + '（仍可编辑规则）');
  } catch (e) {
    setStatus('加载失败: ' + e.message);
  }
}

function renderAll() {
  renderStats();
  renderSources();
  renderRules();
  renderPreview();
}

function renderStats() {
  var cards = [
    ['源分组', SNAPSHOT ? SNAPSHOT.groups.length : 0],
    ['源条目', SNAPSHOT ? SNAPSHOT.totalEntries : 0],
    ['自定义规则', RULES.length],
    ['规则模式', '纯自定义']
  ];
  var html = '';
  for (var i = 0; i < cards.length; i++) {
    html += '<div class="stat"><div class="stat-label">' + esc(cards[i][0]) + '</div><div class="stat-value">' + esc(cards[i][1]) + '</div></div>';
  }
  document.getElementById('stats').innerHTML = html;
}

/* ── 左侧：源组 / 频道 ─────────────────────────────── */
function sourceTargets(group) {
  if (PREVIEW) {
    for (var i = 0; i < PREVIEW.sources.length; i++) {
      if (PREVIEW.sources[i].group === group) {
        var m = {};
        PREVIEW.sources[i].targets.forEach(function(t) { m[t.group] = t.count; });
        return m;
      }
    }
  }
  if (SNAPSHOT) {
    for (var j = 0; j < SNAPSHOT.groups.length; j++) {
      if (SNAPSHOT.groups[j].group === group) return SNAPSHOT.groups[j].targets || {};
    }
  }
  return {};
}

function renderSources() {
  var box = document.getElementById('srcTree');
  if (!SNAPSHOT) {
    box.innerHTML = '<div class="empty">' + esc(SNAPSHOT_ERROR || '还没有快照，请先 refresh') + '</div>';
    document.getElementById('srcCount').textContent = '';
    return;
  }
  document.getElementById('srcTargetLegend').textContent = PREVIEW ? '预览目标' : '上次合并目标';
  var q = (document.getElementById('srcSearch').value || '').toLowerCase();
  var list = SNAPSHOT.groups.filter(function(g) {
    if (!q) return true;
    if (String(g.group).toLowerCase().indexOf(q) >= 0) return true;
    return (g.channels || []).some(function(c) { return String(c).toLowerCase().indexOf(q) >= 0; });
  });
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var g = list[i];
    var open = EXPANDED_SOURCE === g.group;
    var targets = sourceTargets(g.group);
    var chips = '';
    Object.keys(targets).sort(function(a, b) { return targets[b] - targets[a]; }).forEach(function(t) {
      chips += '<span class="chip ' + (t === '__filter__' || t === '轮播台' ? 'red' : 'ch-chip') + '">' + esc(targetLabel(t)) + ' <b>' + targets[t] + '</b></span>';
    });
    var channels = '';
    if (open) {
      var chs = (g.channels || []).slice(0, SOURCE_LIMIT);
      channels = chs.map(function(c) {
        return '<div class="ch-row' + (PICKED_CHANNEL === c ? ' active' : '') + '" onclick="pickChannel(\\'' + js(g.group) + '\\',\\'' + js(c) + '\\')">' +
          '<span>' + esc(c) + '</span><span class="arrow">→ 规则</span></div>';
      }).join('');
      if ((g.channels || []).length > SOURCE_LIMIT) {
        channels += '<div class="more" onclick="showMoreSource()">显示更多（' + ((g.channels || []).length - SOURCE_LIMIT) + '）</div>';
      }
    }
    html += '<div class="tree-group' + (open ? ' open' : '') + '">' +
      '<div class="group-row' + (SELECTED_SOURCE === g.group ? ' active' : '') + '" onclick="toggleSource(\\'' + js(g.group) + '\\')">' +
      '<span class="caret">▶</span><span class="g-name">' + esc(g.group) + '</span><span class="g-count">' + g.count.toLocaleString() + '</span></div>' +
      '<div class="g-targets">' + chips + '</div>' +
      (open ? '<div class="ch-list">' + channels + '</div>' : '') +
      '</div>';
  }
  document.getElementById('srcCount').textContent = list.length + ' / ' + SNAPSHOT.groups.length;
  box.innerHTML = html || '<div class="empty">没有匹配的源组</div>';
}
function toggleSource(group) {
  SELECTED_SOURCE = group;
  EXPANDED_SOURCE = EXPANDED_SOURCE === group ? '' : group;
  SOURCE_LIMIT = 30;
  renderSources();
}
function showMoreSource() { SOURCE_LIMIT += 50; renderSources(); }
function js(s) { return String(s == null ? '' : s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'"); }
function pickChannel(group, channel) {
  PICKED_CHANNEL = channel;
  SELECTED_SOURCE = group;
  SELECTED_RULE = -1;
  document.getElementById('fGroup').value = '^' + reEsc(group) + '$';
  document.getElementById('fChannel').value = '^' + reEsc(channel) + '$';
  setTargetValue('__default__');
  document.getElementById('fPrefix').value = '';
  document.getElementById('fOrder').value = '—';
  document.getElementById('detailState').textContent = '新建规则';
  updateMatchInfo();
  renderSources();
  renderRules();
  setStatus('已从左侧填入：' + group + ' / ' + channel);
}

/* ── 整组过滤 ─────────────────────────────────────── */
/* ── 内置规则 ─────────────────────────────────────── */
/* ── 自定义规则 ───────────────────────────────────── */
function renderRules() {
  document.getElementById('ruleCount').textContent = RULES.length + ' 条';
  var html = '';
  for (var i = 0; i < RULES.length; i++) {
    var r = RULES[i];
    var pat = (r.groupPattern || '(任意组)') + (r.channelPattern ? ' / ' + r.channelPattern : '');
    var enabled = r.enabled !== false;
    html += '<div class="rule-card' + (SELECTED_RULE === i ? ' active' : '') + (enabled ? '' : ' disabled') + '" draggable="true" ' +
      'ondragstart="onDragStart(event,' + i + ')" ondragover="onDragOver(event,' + i + ')" ondrop="onDrop(event,' + i + ')" ondragend="onDragEnd(event)" ' +
      'onclick="selectRule(' + i + ')">' +
      '<div class="rule-top"><span class="drag-handle">⋮⋮</span><span class="rule-order">' + (i + 1) + '</span>' +
      '<span class="rule-name">' + esc(pat) + '</span>' +
      '<input type="checkbox" class="rule-enable" ' + (enabled ? 'checked' : '') + ' title="启用/停用" onclick="event.stopPropagation()" onchange="toggleRuleEnabled(' + i + ',this.checked)">' +
      '</div><div class="rule-meta">→ <b>' + esc(targetLabel(r.target)) + '</b>' + (r.prefix ? ' · 前缀 ' + esc(r.prefix === 'province' ? '省份' : r.prefix) : '') + '</div></div>';
  }
  document.getElementById('ruleList').innerHTML = html || '<div class="empty">还没有自定义规则</div>';
}
function toggleRuleEnabled(i, on) {
  if (!RULES[i]) return;
  RULES[i].enabled = on;
  markDirty(); renderRules(); setStatus('规则 ' + (i + 1) + ' 已' + (on ? '启用' : '停用'));
}
function onDragStart(event, i) {
  DRAG_INDEX = i;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(i));
  event.currentTarget.classList.add('dragging');
}
function onDragOver(event, i) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
function onDrop(event, to) {
  event.preventDefault();
  var from = DRAG_INDEX;
  if (from == null || from === to) return;
  var moved = RULES.splice(from, 1)[0];
  RULES.splice(to, 0, moved);
  DRAG_INDEX = null;
  SELECTED_RULE = to;
  markDirty(); renderRules(); selectRule(to);
  setStatus('规则顺序已调整：第 ' + (to + 1) + ' 位');
}
function onDragEnd(event) { event.currentTarget.classList.remove('dragging'); DRAG_INDEX = null; }
function selectRule(i) {
  SELECTED_RULE = i;
  var r = RULES[i];
  if (!r) return;
  PICKED_CHANNEL = '';
  document.getElementById('fGroup').value = r.groupPattern || '';
  document.getElementById('fChannel').value = r.channelPattern || '';
  setTargetValue(r.target || '__default__');
  document.getElementById('fPrefix').value = r.prefix || '';
  document.getElementById('fOrder').value = '第 ' + (i + 1) + ' 位 / 共 ' + RULES.length + ' 条';
  document.getElementById('detailState').textContent = '编辑 #' + (i + 1);
  renderRules(); renderSources(); updateMatchInfo();
}
function newRule() {
  SELECTED_RULE = -1; PICKED_CHANNEL = '';
  document.getElementById('fGroup').value = '';
  document.getElementById('fChannel').value = '';
  setTargetValue('__default__');
  document.getElementById('fPrefix').value = '';
  document.getElementById('fOrder').value = '—';
  document.getElementById('detailState').textContent = '';
  updateMatchInfo(); renderRules(); renderSources();
}
function clearForm() { newRule(); setStatus('已清空规则详情'); }
function deleteSelectedRule() {
  if (SELECTED_RULE < 0 || !RULES[SELECTED_RULE]) return;
  if (!confirm('删除这条规则？')) return;
  RULES.splice(SELECTED_RULE, 1);
  SELECTED_RULE = Math.max(0, SELECTED_RULE - 1);
  markDirty(); renderRules(); newRule(); setStatus('规则已删除（草稿）');
}
function onTargetChange() {
  var sel = document.getElementById('fTarget');
  var custom = document.getElementById('fTargetCustom');
  custom.style.display = sel.value === '__custom__' ? 'block' : 'none';
  if (sel.value === '__custom__') custom.focus();
  if (sel.value === '地方台' && !document.getElementById('fPrefix').value) {
    document.getElementById('fPrefix').value = 'province';
  }
}
function saveRuleDraft() {
  var target = getTargetValue();
  var gp = document.getElementById('fGroup').value.trim();
  var cp = document.getElementById('fChannel').value.trim();
  if (target === '__custom__' || !target) {
    setStatus('请填写自定义目标分组');
    return;
  }
  if ((gp && !safeRe(gp)) || (cp && !safeRe(cp))) {
    setStatus('源组或频道正则不合法，未保存');
    return;
  }
  if (!gp && !cp) {
    setStatus('源组和频道正则不能同时为空，避免全量匹配');
    return;
  }
  if (target === '__default__') {
    if (SELECTED_RULE >= 0) {
      RULES.splice(SELECTED_RULE, 1);
      SELECTED_RULE = -1;
      markDirty(); renderRules(); newRule();
      setStatus('已删除该规则（草稿）');
    } else {
      setStatus('选择具体目标才能创建规则');
    }
    return;
  }
  var existing = SELECTED_RULE >= 0 ? RULES[SELECTED_RULE] : null;
  var rule = {
    id: existing ? existing.id : 'r' + Date.now(),
    enabled: existing ? existing.enabled !== false : true,
    groupPattern: document.getElementById('fGroup').value.trim(),
    channelPattern: document.getElementById('fChannel').value.trim(),
    target: target,
    prefix: document.getElementById('fPrefix').value,
    priority: 0
  };
  if (SELECTED_RULE >= 0 && RULES[SELECTED_RULE]) RULES[SELECTED_RULE] = rule;
  else { RULES.push(rule); SELECTED_RULE = RULES.length - 1; }
  markDirty(); renderRules(); selectRule(SELECTED_RULE);
  setStatus('规则已加入草稿；保存后 refresh 生效');
}
function rulesForSave() {
  var n = RULES.length;
  return RULES.map(function(r, i) { return Object.assign({}, r, { priority: (n - i) * 10 }); });
}
function updateMatchInfo() {
  var gp = document.getElementById('fGroup').value.trim();
  var cp = document.getElementById('fChannel').value.trim();
  var reG = safeRe(gp), reC = safeRe(cp);
  var groups = 0, channels = 0;
  if (SNAPSHOT) {
    SNAPSHOT.groups.forEach(function(g) {
      if (reG && !reG.test(g.group)) return;
      groups++;
      (g.channels || []).forEach(function(c) { if (!reC || reC.test(c)) channels++; });
    });
  }
  var bad = (gp && !reG) || (cp && !reC);
  document.getElementById('matchInfo').innerHTML = '当前规则匹配 <b>' + groups + '</b> 个源组、<b>' + channels + '</b> 个源频道' +
    (bad ? ' · <span style="color:var(--red)">正则不合法</span>' : '');
}

/* ── 右侧：整理后 ─────────────────────────────────── */
function renderPreview() {
  var box = document.getElementById('targetTree');
  if (!PREVIEW) {
    document.getElementById('targetCount').textContent = '';
    box.innerHTML = '<div class="empty">' + (PREVIEW_DIRTY ? '规则已修改，点「预览」查看整理结果' : '点「预览」查看整理结果') + '</div>';
    return;
  }
  var q = (document.getElementById('targetSearch').value || '').toLowerCase();
  var list = PREVIEW.targets.filter(function(t) {
    if (!q) return true;
    if (String(t.group).toLowerCase().indexOf(q) >= 0) return true;
    return t.channels.some(function(c) { return String(c.name).toLowerCase().indexOf(q) >= 0; });
  });
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var open = EXPANDED_TARGET === t.group;
    var filtered = t.group === '__filter__';
    var channels = '';
    if (open) {
      channels = t.channels.slice(0, TARGET_LIMIT).map(function(c) {
        return '<div class="t-ch' + (filtered ? ' filtered' : '') + '"><span>' + esc(c.name) + '</span><span class="from">' + esc(c.sourceGroup) + '</span></div>';
      }).join('');
      if (t.channels.length > TARGET_LIMIT) channels += '<div class="more" onclick="showMoreTarget()">显示更多（' + (t.channels.length - TARGET_LIMIT) + '）</div>';
    }
    html += '<div class="target-group' + (open ? ' open' : '') + '">' +
      '<div class="target-row' + (EXPANDED_TARGET === t.group ? ' active' : '') + '" onclick="toggleTarget(\\'' + js(t.group) + '\\')">' +
      '<span class="caret">▶</span><span class="t-name">' + esc(targetLabel(t.group)) + '</span><span class="t-count">' + t.count.toLocaleString() + '</span></div>' +
      (open ? '<div class="t-channels">' + channels + '</div>' : '') + '</div>';
  }
  document.getElementById('targetCount').textContent = list.length + ' / ' + PREVIEW.targets.length + ' 组';
  document.getElementById('previewTime').textContent = PREVIEW_DIRTY ? '预览已过期' : (PREVIEW_AT ? '预览 ' + formatTime(PREVIEW_AT) : '—');
  box.innerHTML = html || '<div class="empty">没有匹配的目标组</div>';
}
function toggleTarget(group) { EXPANDED_TARGET = EXPANDED_TARGET === group ? '' : group; renderPreview(); }
function showMoreTarget() { TARGET_LIMIT += 100; renderPreview(); }

/* ── 预览 / 保存 / 刷新 ───────────────────────────── */
async function doPreview() {
  setStatus('预览中...');
  try {
    var res = await api('/admin/live-group-preview', {
      method: 'POST',
      body: Object.assign({ rules: rulesForSave(), filterTargets: [], builtin: undefined, useBuiltin: false }, sortForSave())
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { setStatus('预览失败: ' + (data.error || res.status)); return; }
    PREVIEW = data.preview;
    PREVIEW_DIRTY = false;
    PREVIEW_AT = Date.now();
    renderSources();
    renderPreview();
    setStatus('预览完成：' + PREVIEW.total + ' 个频道 / ' + PREVIEW.targets.length + ' 个目标组');
  } catch (e) { setStatus('预览失败: ' + e.message); }
}
async function saveRules() {
  setStatus('保存中...');
  try {
    var res = await api('/admin/live-group-rules', {
      method: 'PUT',
      body: Object.assign({ rules: rulesForSave(), filterTargets: [], builtin: undefined, useBuiltin: false }, sortForSave())
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { setStatus('保存失败: ' + (data.error || res.status)); return false; }
    RULES = (data.ruleSet.rules || []).slice().sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });
    SORT = {
      groupOrder: Array.isArray(data.ruleSet.groupOrder) ? data.ruleSet.groupOrder : [],
      channelSort: data.ruleSet.channelSort === 'name' ? 'name' : 'default',
      failedLast: data.ruleSet.failedLast === true
    };
    syncSortControls();
    SELECTED_RULE = RULES.length > 0 ? 0 : -1;
    renderAll();
    if (SELECTED_RULE >= 0) selectRule(0); else newRule();
    setStatus('已保存；下次 refresh 生效，不需要重启');
    return true;
  } catch (e) { setStatus('保存失败: ' + e.message); return false; }
}
async function saveAndRefresh() {
  if (!(await saveRules())) return;
  setStatus('刷新中，全量抓取约 1 分钟...');
  try {
    var res = await api('/refresh', { method: 'POST' });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { setStatus('刷新失败: ' + (data.error || res.status)); return; }
    setStatus('刷新完成，重新加载快照...');
    await loadAll();
  } catch (e) { setStatus('刷新失败: ' + e.message); }
}

/* ── 导入 / 导出 ──────────────────────────────────── */
function exportRules() {
  var data = Object.assign({
    version: 1,
    exportedAt: new Date().toISOString(),
    kind: 'tvbox-live-group-rules',
    useBuiltin: false,
    rules: rulesForSave(),
    filterTargets: []
  }, sortForSave());
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  var d = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  a.download = 'live-group-rules-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
  setStatus('已导出规则 JSON');
}
async function importRules(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { setStatus('导入失败：文件超过 2 MB'); input.value = ''; return; }
  try {
    var text = await file.text();
    var data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !Array.isArray(data.rules)) throw new Error('缺少 rules 数组');
    var importedUseBuiltin = false;
    var imported = {
      rules: data.rules,
      filterTargets: [],
      useBuiltin: importedUseBuiltin,
      groupOrder: Array.isArray(data.groupOrder) ? data.groupOrder : [],
      channelSort: data.channelSort === 'name' ? 'name' : 'default',
      failedLast: data.failedLast === true
    };
    var check = await api('/admin/live-group-preview', { method: 'POST', body: imported });
    var err = await check.json().catch(function() { return {}; });
    if (!check.ok) { setStatus('导入校验失败: ' + (err.error || check.status)); input.value = ''; return; }
    if (!confirm('导入 ' + imported.rules.length + ' 条规则、' + imported.filterTargets.length + ' 个整组过滤，将覆盖当前草稿，继续？')) { input.value = ''; return; }
    LAST_IMPORT_BACKUP = { rules: clone(RULES), sort: clone(SORT) };
    RULES = imported.rules.slice().sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });
    SORT = { groupOrder: imported.groupOrder, channelSort: imported.channelSort, failedLast: imported.failedLast };
    syncSortControls();
    SELECTED_RULE = -1; PREVIEW = null; PREVIEW_DIRTY = true;
    document.getElementById('undoImport').style.display = 'inline-block';
    renderAll();
    if (RULES.length > 0) selectRule(0); else newRule();
    setStatus('已导入到草稿；检查后点「保存规则」写入 KV');
  } catch (e) {
    setStatus('导入失败: ' + e.message);
  }
  input.value = '';
}
function undoImport() {
  if (!LAST_IMPORT_BACKUP) return;
  RULES = clone(LAST_IMPORT_BACKUP.rules);
  if (LAST_IMPORT_BACKUP.sort) { SORT = clone(LAST_IMPORT_BACKUP.sort); syncSortControls(); }
  LAST_IMPORT_BACKUP = null;
  document.getElementById('undoImport').style.display = 'none';
  SELECTED_RULE = -1; PREVIEW = null; PREVIEW_DIRTY = true;
  renderAll();
  if (RULES.length > 0) selectRule(0); else newRule();
  setStatus('已恢复导入前的草稿；点「保存规则」写入');
}

applyTheme(getTheme());
initThemeDropdown();
document.body.style.opacity = '1';
</script>
</body>
</html>`;
