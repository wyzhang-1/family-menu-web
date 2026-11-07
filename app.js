/* 家的菜单 · 网页版
 * 纯前端，无框架。本地 localStorage 为主存储，Supabase 作为可选的两人同步通道。
 */
(function () {
  'use strict';

  // ============================================================
  // 配置
  // ============================================================
  var CFG = window.FAMILY_MENU_CONFIG || {};
  var K = {
    dishes: 'fmw_dishes', orders: 'fmw_orders', profile: 'fmw_profile',
    family: 'fmw_family', sync: 'fmw_sync', checks: 'fmw_checks', seeded: 'fmw_seeded'
  };

  var CATS = [
    { id: 'all', name: '全部', emoji: '🍽', tone: '' },
    { id: 'meat', name: '荤菜', emoji: '🍖', tone: 'tone-a' },
    { id: 'veg', name: '素菜', emoji: '🥬', tone: 'tone-b' },
    { id: 'soup', name: '汤羹', emoji: '🍲', tone: 'tone-c' },
    { id: 'staple', name: '主食', emoji: '🍚', tone: 'tone-f' },
    { id: 'dessert', name: '甜点', emoji: '🍰', tone: 'tone-e' },
    { id: 'drink', name: '饮品', emoji: '🥤', tone: 'tone-d' }
  ];
  var CAT_MAP = {};
  CATS.forEach(function (c) { CAT_MAP[c.id] = c; });
  var AVATARS = ['🧑', '👩', '👨', '🧔', '👧', '👦', '🧓', '🐱', '🐶', '🐰', '🐼', '🦊'];
  var DISH_EMOJIS = ['🍅', '🍗', '🥦', '🍲', '🍚', '🍜', '🥟', '🍤', '🥘', '🍳', '🌽', '🥕', '🍆', '🥔', '🐟', '🍰', '🥤', '🍵'];

  // ============================================================
  // 工具
  // ============================================================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(p) { return (p || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function readJSON(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('本地存储已满，请清理一些图片'); }
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return ['夜深了', '🌙'];
    if (h < 11) return ['早上好', '🌤'];
    if (h < 14) return ['中午好', '👋'];
    if (h < 18) return ['下午好', '☀️'];
    return ['晚上好', '🌆'];
  }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 1900);
  }
  function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 8); } catch (e) {} } }

  // ============================================================
  // 状态
  // ============================================================
  var S = {
    dishes: [], orders: [],
    profile: { name: '我', emoji: '🧑' },
    family: { id: '', name: '我们的小家', createdAt: 0 },
    checks: {},
    view: 'menu',
    cat: 'all',
    q: '',
    editing: null,
    route: { name: 'menu', param: '' }
  };

  var SYNC = {
    url: '', key: '', on: false, lastPull: 0, timer: null, busy: false, err: '', lastOk: 0
  };

  function load() {
    S.dishes = readJSON(K.dishes, []);
    S.orders = readJSON(K.orders, []);
    S.checks = readJSON(K.checks, {});
    var p = readJSON(K.profile, null);
    if (p) S.profile = p;
    var f = readJSON(K.family, null);
    if (f) S.family = f;
    var sc = readJSON(K.sync, null);
    if (sc) {
      SYNC.url = sc.url || '';
      SYNC.key = sc.key || '';
      SYNC.on = !!(SYNC.url && SYNC.key);
      SYNC.lastPull = sc.lastPull || 0;
      SYNC.disabled = !!sc.disabled;
    }
    if (!SYNC.disabled && CFG.supabaseUrl && CFG.supabaseAnonKey && !SYNC.on) {
      SYNC.url = String(CFG.supabaseUrl).replace(/\/+$/, '');
      SYNC.key = CFG.supabaseAnonKey;
      SYNC.on = true;
    }
    if (!S.family.id) {
      S.family = { id: newFamilyCode(), name: '我们的小家', createdAt: Date.now() };
      writeJSON(K.family, S.family);
    }
  }

  function saveDishes() { writeJSON(K.dishes, S.dishes); }
  function saveOrders() { writeJSON(K.orders, S.orders); }
  function saveSync() {
    writeJSON(K.sync, { url: SYNC.url, key: SYNC.key, lastPull: SYNC.lastPull, disabled: !!SYNC.disabled });
  }

  function newFamilyCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ============================================================
  // 云同步（Supabase REST）
  // ============================================================
  function syncHeaders() {
    return {
      'apikey': SYNC.key,
      'Authorization': 'Bearer ' + SYNC.key,
      'Content-Type': 'application/json'
    };
  }

  function toRow(t, o) {
    var r = {
      id: o.id, family_id: S.family.id, updated_at: o.updatedAt || Date.now(),
      created_at: o.createdAt || Date.now(), deleted: !!o.deleted
    };
    if (t === 'dishes') {
      r.name = o.name || ''; r.category = o.category || 'meat'; r.emoji = o.emoji || '🍽';
      r.image = o.image || ''; r.description = o.desc || '';
      r.tags = o.tags || []; r.ingredients = o.ingredients || [];
      r.seasonings = o.seasonings || []; r.steps = o.steps || [];
    } else {
      r.dish_id = o.dishId || ''; r.name = o.name || ''; r.image = o.image || '';
      r.emoji = o.emoji || '🍽'; r.category = o.category || 'meat';
      r.qty = o.qty || 1; r.by_list = o.byList || [];
    }
    return r;
  }
  function fromRow(t, r) {
    var o = {
      id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, deleted: !!r.deleted
    };
    if (t === 'dishes') {
      o.name = r.name || ''; o.category = r.category || 'meat'; o.emoji = r.emoji || '🍽';
      o.image = r.image || ''; o.desc = r.description || '';
      o.tags = r.tags || []; o.ingredients = r.ingredients || [];
      o.seasonings = r.seasonings || []; o.steps = r.steps || [];
    } else {
      o.dishId = r.dish_id || ''; o.name = r.name || ''; o.image = r.image || '';
      o.emoji = r.emoji || '🍽'; o.category = r.category || 'meat';
      o.qty = r.qty || 1; o.byList = r.by_list || [];
    }
    return o;
  }

  function markSync(ok, msg) {
    SYNC.err = ok ? '' : (msg || '同步失败');
    if (ok) SYNC.lastOk = Date.now();
    var el = $('#syncBadge');
    if (el) {
      if (!SYNC.on) { el.classList.remove('on'); return; }
      if (!ok) { el.textContent = '⚠️ ' + SYNC.err; el.classList.add('on'); }
      else el.classList.remove('on');
    }
    var st = $('#syncState');
    if (st) st.textContent = SYNC.on ? (ok ? '已连接' : '连接异常') : '未开启';
  }

  function applyRemote(table, rows) {
    var list = table === 'dishes' ? S.dishes : S.orders;
    var map = {};
    list.forEach(function (d) { map[d.id] = d; });
    var changed = false;
    rows.forEach(function (r) {
      var o = fromRow(table, r);
      var old = map[o.id];
      if (!old || (o.updatedAt || 0) > (old.updatedAt || 0)) { map[o.id] = o; changed = true; }
    });
    if (!changed) return false;
    var next = Object.keys(map).map(function (k) { return map[k]; });
    if (table === 'dishes') { S.dishes = next; saveDishes(); } else { S.orders = next; saveOrders(); }
    return true;
  }

  function pull() {
    if (!SYNC.on || SYNC.busy) return Promise.resolve();
    SYNC.busy = true;
    var since = SYNC.lastPull || 0;
    var fid = encodeURIComponent(S.family.id);
    var tables = ['dishes', 'orders'];
    var changed = false;
    return tables.reduce(function (p, t) {
      return p.then(function () {
        var url = SYNC.url + '/rest/v1/' + t +
          '?family_id=eq.' + fid + '&updated_at=gt.' + since +
          '&select=*&order=updated_at.asc&limit=1000';
        return fetch(url, { headers: syncHeaders() }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          if (applyRemote(t, rows)) changed = true;
          rows.forEach(function (row) { if ((row.updated_at || 0) > since) { since = row.updated_at; } });
        });
      });
    }, Promise.resolve()).then(function () {
      SYNC.lastPull = since;
      saveSync();
      SYNC.busy = false;
      markSync(true);
      if (changed) { render(); }
    }).catch(function (e) {
      SYNC.busy = false;
      markSync(false, '连不上云端');
      console.warn('[sync pull]', e);
    });
  }

  function pushRows(table, objs) {
    if (!SYNC.on || !objs.length) return Promise.resolve();
    var body = objs.map(function (o) { return toRow(table, o); });
    return fetch(SYNC.url + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign(syncHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      markSync(true);
    }).catch(function (e) {
      markSync(false, '同步失败');
      console.warn('[sync push]', table, e);
    });
  }

  function startPolling() {
    if (SYNC.timer) clearInterval(SYNC.timer);
    SYNC.timer = setInterval(function () {
      if (document.hidden) return;
      pull();
    }, 5000);
  }

  function testConnection() {
    var url = SYNC.url.replace(/\/+$/, '');
    return fetch(url + '/rest/v1/dishes?select=id&limit=1', {
      headers: { 'apikey': SYNC.key, 'Authorization': 'Bearer ' + SYNC.key }
    }).then(function (r) {
      if (r.status === 404 || r.status === 400) return { ok: true, warn: '表还没建，请先执行 SQL' };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { ok: true };
    });
  }

  // ============================================================
  // 示例菜品
  // ============================================================
  function seedIfEmpty() {
    if (readJSON(K.seeded, false)) return;
    if (S.dishes.length) { writeJSON(K.seeded, true); return; }
    var now = Date.now();
    var demo = [
      {
        name: '番茄炒蛋', category: 'meat', emoji: '🍅', desc: '酸甜下饭，十分钟搞定的国民菜',
        tags: ['快手', '家常'], ingredients: [{ name: '番茄', amount: '2 个' }, { name: '鸡蛋', amount: '3 个' }],
        seasonings: [{ name: '盐', amount: '适量' }, { name: '糖', amount: '1 小勺' }, { name: '葱花', amount: '少许' }],
        steps: ['番茄切块，鸡蛋打散加少许盐', '热锅热油，倒入蛋液炒至凝固盛出', '下番茄炒出汁，加糖和盐', '倒回鸡蛋翻炒均匀，撒葱花出锅']
      },
      {
        name: '可乐鸡翅', category: 'meat', emoji: '🍗', desc: '一罐可乐焖出来的甜咸软糯',
        tags: ['下饭', '有面子'], ingredients: [{ name: '鸡翅中', amount: '8 个' }, { name: '可乐', amount: '1 罐' }],
        seasonings: [{ name: '生抽', amount: '2 勺' }, { name: '姜片', amount: '3 片' }, { name: '料酒', amount: '1 勺' }],
        steps: ['鸡翅划两刀，冷水下锅焯水去腥', '少油煎至两面金黄', '倒入可乐、生抽、姜片、料酒', '小火焖 15 分钟，大火收汁']
      },
      {
        name: '蒜蓉西兰花', category: 'veg', emoji: '🥦', desc: '清爽解腻，颜色也好看',
        tags: ['清淡', '快手'], ingredients: [{ name: '西兰花', amount: '1 颗' }, { name: '蒜', amount: '4 瓣' }],
        seasonings: [{ name: '盐', amount: '适量' }, { name: '蚝油', amount: '1 勺' }],
        steps: ['西兰花掰小朵，盐水泡 10 分钟', '沸水焯 1 分钟捞出过凉', '蒜末爆香，下西兰花翻炒', '加蚝油和盐，翻匀出锅']
      },
      {
        name: '紫菜蛋花汤', category: 'soup', emoji: '🍲', desc: '五分钟的一碗热汤',
        tags: ['快手', '清淡'], ingredients: [{ name: '紫菜', amount: '1 小把' }, { name: '鸡蛋', amount: '1 个' }],
        seasonings: [{ name: '盐', amount: '适量' }, { name: '香油', amount: '几滴' }, { name: '葱花', amount: '少许' }],
        steps: ['水烧开，放入撕碎的紫菜', '淋入打散的蛋液，画圈搅出蛋花', '加盐调味，关火滴香油撒葱花']
      }
    ];
    S.dishes = demo.map(function (d, i) {
      return Object.assign({
        id: uid('dish'), image: '', createdAt: now - i * 1000, updatedAt: now - i * 1000, deleted: false
      }, d);
    });
    saveDishes();
    writeJSON(K.seeded, true);
  }

  // ============================================================
  // 查询
  // ============================================================
  function aliveDishes() {
    return S.dishes.filter(function (d) { return !d.deleted; });
  }
  function aliveOrders() {
    return S.orders.filter(function (o) { return !o.deleted; });
  }
  function getDish(id) {
    for (var i = 0; i < S.dishes.length; i++) if (S.dishes[i].id === id) return S.dishes[i];
    return null;
  }
  function upsertDish(dish) {
    var found = false;
    for (var i = 0; i < S.dishes.length; i++) {
      if (S.dishes[i].id === dish.id) { S.dishes[i] = dish; found = true; break; }
    }
    if (!found) S.dishes.push(dish);
    saveDishes();
    pushRows('dishes', [dish]);
  }
  function upsertOrder(order) {
    var found = false;
    for (var i = 0; i < S.orders.length; i++) {
      if (S.orders[i].id === order.id) { S.orders[i] = order; found = true; break; }
    }
    if (!found) S.orders.push(order);
    saveOrders();
    pushRows('orders', [order]);
  }
  function dishOnTable(dishId) {
    return aliveOrders().some(function (o) { return o.dishId === dishId; });
  }
  function addToTable(dish) {
    var same = aliveOrders().filter(function (o) { return o.dishId === dish.id; })[0];
    var now = Date.now();
    if (same) {
      same.qty = (same.qty || 1) + 1;
      same.updatedAt = now;
      upsertOrder(same);
    } else {
      upsertOrder({
        id: uid('order'), dishId: dish.id, name: dish.name, image: dish.image || '',
        emoji: dish.emoji || '🍽', category: dish.category, qty: 1,
        byList: [{ name: S.profile.name, emoji: S.profile.emoji }],
        createdAt: now, updatedAt: now, deleted: false
      });
    }
    toast('已加到今日餐桌');
    vibrate(10);
    if (S.route.name === 'menu') render();
  }

  // ============================================================
  // 图片压缩
  // ============================================================
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(cv.toDataURL('image/jpeg', quality || 0.78));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  // 渲染框架
  // ============================================================
  function render() {
    var app = $('#app');
    if (!app) return;
    var v = S.route.name;
    var html = '';
    if (v === 'menu') html = viewMenu();
    else if (v === 'table') html = viewTable();
    else if (v === 'profile') html = viewProfile();
    else if (v === 'detail') html = viewDetail(S.route.param);
    else if (v === 'edit') html = viewEdit(S.route.param);
    else if (v === 'meal') html = viewMeal();
    app.innerHTML = html + tabbar(v);
    afterRender();
  }

  function tabbar(active) {
    if (['detail', 'edit', 'meal'].indexOf(active) >= 0) return '';
    var items = [
      { id: 'menu', ic: '🍳', name: '菜单' },
      { id: 'table', ic: '🍽', name: '餐桌' },
      { id: 'profile', ic: '🙋', name: '我的' }
    ];
    return '<nav class="tabbar"><div class="tabbar-in">' + items.map(function (it) {
      return '<button class="tab' + (active === it.id ? ' on' : '') + '" data-act="go" data-page="' + it.id + '">' +
        '<span class="ti">' + it.ic + '</span><span>' + it.name + '</span></button>';
    }).join('') + '</div></nav>';
  }

  function afterRender() {
    var app = $('#app');
    if (!app) return;
    // 编辑页图片预览
    var imgInput = $('#fImage');
    if (imgInput) {
      imgInput.onchange = function () {
        var f = imgInput.files && imgInput.files[0];
        if (!f) return;
        toast('处理图片…');
        compressImage(f, 720, 0.72).then(function (data) {
          S.editing.image = data;
          var cov = $('#coverArea');
          if (cov) cov.innerHTML = coverInner();
        }).catch(function () { toast('图片读取失败'); });
      };
    }
  }

  // ============================================================
  // 视图：首页
  // ============================================================
  function viewMenu() {
    var g = greeting();
    var all = aliveDishes().slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var list = all.filter(function (d) {
      if (S.cat !== 'all' && d.category !== S.cat) return false;
      if (!S.q) return true;
      var q = S.q.toLowerCase();
      if ((d.name || '').toLowerCase().indexOf(q) >= 0) return true;
      var pool = [].concat(d.ingredients || [], d.seasonings || []).map(function (x) { return x.name || ''; }).join(' ');
      return pool.toLowerCase().indexOf(q) >= 0;
    });
    var onTableCount = aliveOrders().length;

    return '<div class="hero">' +
      '<div class="blob b1"></div><div class="blob b2"></div>' +
      '<div class="hero-top"><div>' +
      '<h1 class="hi">' + g[0] + ' <span>' + g[1] + '</span></h1>' +
      '<p class="sub">' + esc(S.family.name || '我们的小家') + ' · 今天想吃点什么？</p>' +
      '</div><button class="avatar press" data-act="go" data-page="profile">' + esc(S.profile.emoji) + '</button></div>' +
      '<div class="search"><span class="ic">🔍</span>' +
      '<input id="qInput" placeholder="搜索菜名、配菜或佐料" value="' + esc(S.q) + '"></div>' +
      '</div>' +
      '<div class="quick">' +
      '<button class="qcard press" data-act="random"><div class="qb"><p class="qt">今晚吃什么</p><p class="qs">随机来一道</p></div><span class="qi">🎲</span></button>' +
      '<button class="qcard press" data-act="go" data-page="table"><div class="qb"><p class="qt">今日餐桌</p><p class="qs">' +
      (onTableCount ? onTableCount + ' 道菜已上桌' : '还空着，去点菜') + '</p></div><span class="qi">🍽</span></button>' +
      '</div>' +
      '<div class="chips">' + CATS.map(function (c) {
        return '<button class="chip' + (S.cat === c.id ? ' on' : '') + '" data-act="cat" data-cat="' + c.id + '">' +
          (c.id === 'all' ? '🍽 全部' : c.emoji + ' ' + c.name) + '</button>';
      }).join('') + '</div>' +
      '<div class="sec-head"><h2 class="sec-title">' + (S.cat === 'all' ? '全部菜品' : CAT_MAP[S.cat].name) +
      '<small>' + list.length + ' 道</small></h2><span class="sec-hint">共 ' + all.length + ' 道家常味</span></div>' +
      (list.length ? '<div class="grid">' + list.map(dishCard).join('') + '</div>' :
        '<div class="empty"><div class="ee">🍳</div><p class="et">' +
        (S.q ? '没搜到这道菜' : '还没有菜，先加一道吧') + '</p><p class="es">' +
        (S.q ? '换个关键词试试' : '点右下角的 + 开始记录你家的味道') + '</p></div>') +
      '<div style="height:20px"></div>' +
      '<button class="fab press" data-act="newDish">＋</button>';
  }

  function dishCard(d) {
    var c = CAT_MAP[d.category] || CAT_MAP.meat;
    var on = dishOnTable(d.id);
    return '<article class="card press" data-act="open" data-id="' + d.id + '">' +
      '<div class="thumb ' + (c.tone || 'tone-a') + '">' +
      (d.image ? '<img src="' + d.image + '" alt="">' : '<span class="em">' + esc(d.emoji || c.emoji) + '</span>') +
      '<span class="tag">' + c.emoji + ' ' + c.name + '</span>' +
      (on ? '<span class="on-table">已上桌</span>' : '') +
      '</div>' +
      '<div class="body"><h3 class="name">' + esc(d.name) + '</h3>' +
      '<p class="desc">' + esc(d.desc || '还没写介绍') + '</p>' +
      '<div class="meta"><span>🧺 ' + ((d.ingredients || []).length) + '</span>' +
      '<span>🧂 ' + ((d.seasonings || []).length) + '</span>' +
      '<span class="add" data-act="quickAdd" data-id="' + d.id + '">＋</span></div></div></article>';
  }

  // ============================================================
  // 视图：详情
  // ============================================================
  function viewDetail(id) {
    var d = getDish(id);
    if (!d || d.deleted) return '<div class="nav"><button class="back" data-act="back">‹</button>' +
      '<div class="title">菜品</div><div style="width:38px"></div></div>' +
      '<div class="empty"><div class="ee">🍽</div><p class="et">这道菜不见了</p></div>';
    var c = CAT_MAP[d.category] || CAT_MAP.meat;
    var key = 'd_' + d.id;
    var ck = S.checks[key] || {};
    var ings = d.ingredients || [], seas = d.seasonings || [];

    function ingRow(list, prefix) {
      return list.map(function (it, i) {
        var k = prefix + i;
        return '<div class="ing' + (ck[k] ? ' done' : '') + '" data-act="tick" data-key="' + key + '" data-k="' + k + '">' +
          '<span class="ck">✓</span><span class="nm">' + esc(it.name) + '</span>' +
          '<span class="am">' + esc(it.amount) + '</span></div>';
      }).join('');
    }

    return '<div class="nav"><button class="back" data-act="back">‹</button>' +
      '<div class="title">' + esc(d.name) + '</div>' +
      '<button class="act" data-act="editDish" data-id="' + d.id + '">✎</button></div>' +
      (d.image ? '<img class="hero-img" src="' + d.image + '" alt="">' :
        '<div class="hero-ph ' + (c.tone || 'tone-a') + '">' + esc(d.emoji || c.emoji) + '</div>') +
      '<div class="detail-body">' +
      '<h1 class="detail-title">' + esc(d.name) + '</h1>' +
      (d.desc ? '<p class="detail-desc">' + esc(d.desc) + '</p>' : '') +
      '<div class="tagrow"><span class="tg">' + c.emoji + ' ' + c.name + '</span>' +
      (d.tags || []).map(function (t) { return '<span class="tg">' + esc(t) + '</span>'; }).join('') + '</div>' +
      (ings.length ? '<div class="block"><h3>🧺 配菜<em>' + ings.length + ' 样</em></h3>' + ingRow(ings, 'i') + '</div>' : '') +
      (seas.length ? '<div class="block"><h3>🧂 佐料<em>' + seas.length + ' 味</em></h3>' + ingRow(seas, 's') + '</div>' : '') +
      ((d.steps || []).length ? '<div class="block"><h3>👩‍🍳 做法</h3><ol class="steps">' +
        d.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>' : '') +
      '<button class="btn-primary press" data-act="quickAdd" data-id="' + d.id + '">＋ 加到今日餐桌</button>' +
      '<button class="btn-ghost btn-danger press" data-act="delDish" data-id="' + d.id + '">删除这道菜</button>' +
      '</div>';
  }

  // ============================================================
  // 视图：编辑 / 新增
  // ============================================================
  function newDraft() {
    return {
      id: '', name: '', category: 'meat', emoji: '🍅', image: '', desc: '',
      tags: [], ingredients: [{ name: '', amount: '' }], seasonings: [{ name: '', amount: '' }], steps: []
    };
  }

  function coverInner() {
    if (S.editing.image) {
      return '<img src="' + S.editing.image + '" alt=""><span class="del" data-act="clearImage">✕</span>';
    }
    return '<div class="ph"><span class="i">📷</span><div class="t">加一张成品图</div>' +
      '<div class="s">拍得好看一点，会更有食欲</div></div>';
  }

  function rowsHtml(kind, list) {
    return list.map(function (it, i) {
      return '<div class="row" data-kind="' + kind + '" data-i="' + i + '">' +
        '<input class="nm" placeholder="' + (kind === 'ing' ? '配菜名，如 番茄' : '佐料名，如 盐') + '" value="' + esc(it.name) + '">' +
        '<input class="am" placeholder="用量" value="' + esc(it.amount) + '">' +
        '<button class="x" data-act="delRow" data-kind="' + kind + '" data-i="' + i + '">−</button></div>';
    }).join('');
  }

  function viewEdit(id) {
    if (!S.editing) {
      var d = id ? getDish(id) : null;
      S.editing = d ? clone(d) : newDraft();
      if (d) { S.editing.tags = S.editing.tags || []; }
    }
    var e = S.editing;
    var isNew = !e.id;
    return '<div class="nav">' +
      '<button class="back" data-act="back">‹</button>' +
      '<div class="title">' + (isNew ? '添加菜品' : '编辑菜品') + '</div>' +
      '<button class="save press" data-act="saveDish">保存</button></div>' +
      '<div class="form">' +
      '<label class="cover" id="coverArea" for="fImage">' + coverInner() + '</label>' +
      '<input type="file" id="fImage" accept="image/*" style="display:none">' +

      '<div class="field"><label>菜名</label>' +
      '<input id="fName" placeholder="比如 番茄炒蛋" value="' + esc(e.name) + '"></div>' +

      '<div class="field"><label>分类</label><div class="cats">' +
      CATS.filter(function (c) { return c.id !== 'all'; }).map(function (c) {
        return '<button class="' + (e.category === c.id ? 'on' : '') + '" data-act="setCat" data-cat="' + c.id + '">' +
          c.emoji + ' ' + c.name + '</button>';
      }).join('') + '</div></div>' +

      '<div class="field"><label>封面表情 <em style="color:#BEAF9F;font-weight:600">没有图片时，用它当封面</em></label>' +
      '<div class="emojis">' + DISH_EMOJIS.map(function (em) {
        return '<button class="' + (e.emoji === em ? 'on' : '') + '" data-act="setEmoji" data-em="' + em + '">' + em + '</button>';
      }).join('') + '</div></div>' +

      '<div class="field"><label>一句话介绍</label>' +
      '<textarea id="fDesc" placeholder="这道菜的故事、口味，或者谁最爱吃">' + esc(e.desc) + '</textarea></div>' +

      '<div class="field"><label>标签</label>' +
      '<input id="fTags" placeholder="下饭 快手 家常（空格或逗号分隔）" value="' + esc((e.tags || []).join(' ')) + '"></div>' +

      '<div class="field"><label>🧺 配菜 <em style="color:#BEAF9F;font-weight:600">主料配菜写清楚，买菜不抓瞎</em></label>' +
      '<div class="rows" id="rowsIng">' + rowsHtml('ing', e.ingredients.length ? e.ingredients : [{ name: '', amount: '' }]) + '</div>' +
      '<button class="addrow" data-act="addRow" data-kind="ing">＋ 再加一样配菜</button></div>' +

      '<div class="field"><label>🧂 佐料</label>' +
      '<div class="rows" id="rowsSea">' + rowsHtml('sea', e.seasonings.length ? e.seasonings : [{ name: '', amount: '' }]) + '</div>' +
      '<button class="addrow" data-act="addRow" data-kind="sea">＋ 再加一样佐料</button></div>' +

      '<div class="field"><label>做法（每行一步）</label>' +
      '<textarea id="fSteps" placeholder="番茄切块，鸡蛋打散&#10;热锅热油炒蛋&#10;下番茄炒出汁&#10;倒回鸡蛋翻匀出锅" style="min-height:120px">' +
      esc((e.steps || []).join('\n')) + '</textarea></div>' +

      (isNew ? '' : '<button class="btn-ghost btn-danger press" data-act="delDish" data-id="' + e.id + '">删除这道菜</button>') +
      '<div style="height:20px"></div></div>';
  }

  // ============================================================
  // 视图：餐桌
  // ============================================================
  function viewTable() {
    var list = aliveOrders().slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var by = {};
    list.forEach(function (o) {
      (o.byList || []).forEach(function (p) {
        by[p.name] = by[p.name] || { name: p.name, emoji: p.emoji, n: 0 };
        by[p.name].n++;
      });
    });
    var members = Object.keys(by).map(function (k) { return by[k]; });
    var totalQty = list.reduce(function (s, o) { return s + (o.qty || 1); }, 0);

    var head = '<div class="hero" style="border-radius:0 0 26px 26px;padding-bottom:20px">' +
      '<div class="blob b1"></div><div class="hero-top"><div>' +
      '<h1 class="hi">今日餐桌 🍽</h1><p class="sub">' + todayStr() + ' · 想吃什么点什么</p></div>' +
      '<button class="avatar press" data-act="clearOrders">🧹</button></div></div>';

    if (!list.length) {
      return head + '<div class="quick">' +
        '<button class="qcard press" data-act="go" data-page="menu"><div class="qb"><p class="qt">去点菜</p>' +
        '<p class="qs">从菜单里挑几道</p></div><span class="qi">🍳</span></button>' +
        '<button class="qcard press" data-act="random"><div class="qb"><p class="qt">手气不错</p>' +
        '<p class="qs">随机来一道</p></div><span class="qi">🎲</span></button></div>' +
        '<div class="empty"><div class="ee">🍽</div><p class="et">餐桌还空着</p>' +
        '<p class="es">去菜单里点几道菜，配菜和佐料会自动汇总</p></div>';
    }

    return head +
      '<div class="members" style="padding-top:14px">' + members.map(function (m) {
        return '<span class="mchip">' + esc(m.emoji || '🧑') + ' ' + esc(m.name) + ' 点了 ' + m.n + ' 道</span>';
      }).join('') + '</div>' +
      '<div class="sec-head"><h2 class="sec-title">已上桌<small>' + list.length + ' 道 · ' + totalQty + ' 份</small></h2>' +
      '<span class="sec-hint" style="color:#FF6B35;font-weight:700" data-act="go" data-page="menu">＋ 继续点</span></div>' +
      '<div class="tlist">' + list.map(function (o) {
        var c = CAT_MAP[o.category] || CAT_MAP.meat;
        return '<div class="titem"><div class="th ' + (c.tone || 'tone-a') + '">' +
          (o.image ? '<img src="' + o.image + '" alt="">' : esc(o.emoji || c.emoji)) + '</div>' +
          '<div class="info"><p class="nm">' + esc(o.name) + '</p>' +
          '<span class="by">' + (o.byList || []).map(function (p) { return esc(p.emoji + p.name); }).join('、') + '</span></div>' +
          '<div class="stepper"><button data-act="dec" data-id="' + o.id + '">−</button>' +
          '<span class="q">' + (o.qty || 1) + '</span>' +
          '<button data-act="inc" data-id="' + o.id + '">＋</button></div></div>';
      }).join('') + '</div>' +
      '<div style="height:86px"></div>' +
      '<div class="bar-bottom"><div class="bar-in">' +
      '<button class="btn-ghost2 press" data-act="openPrep">🧺 备菜清单</button>' +
      '<button class="btn-main press" data-act="go" data-page="meal">生成今日菜单</button>' +
      '</div></div>';
  }

  // ============================================================
  // 视图：我的
  // ============================================================
  function viewProfile() {
    var dishCount = aliveDishes().length;
    var orderCount = aliveOrders().length;
    return '<div class="phero"><div class="av">' + esc(S.profile.emoji) + '</div>' +
      '<p class="nm">' + esc(S.profile.name) + '</p>' +
      '<p class="fm">' + esc(S.family.name) + ' · ' + dishCount + ' 道菜</p>' +
      '<span class="mode ' + (SYNC.on ? '' : 'off') + '">' + (SYNC.on ? '☁️ 已开启两人同步' : '📱 仅本机使用') + '</span></div>' +

      '<div class="pcard"><h3>👫 我们的小家</h3><p class="ph2">把这个码给另一半，或者直接把链接发给她/他</p>' +
      '<div class="codebox"><span class="cd">' + esc(S.family.id) + '</span>' +
      '<button data-act="copyCode">复制码</button></div>' +
      '<button class="btn-ghost press" style="margin-top:0" data-act="shareLink">🔗 复制邀请链接</button>' +
      '</div>' +

      '<div class="pcard"><h3>☁️ 云端同步</h3>' +
      '<p class="ph2">' + (SYNC.on ? '状态：<b id="syncState">已连接</b> · 每 5 秒自动同步' :
        '状态：<b id="syncState">未开启</b> · 现在只存在这台设备上') + '</p>' +
      '<button class="linkrow press" data-act="openSync"><span class="li">⚙️</span>' +
      '<span class="lb"><b>' + (SYNC.on ? '修改同步设置' : '开启两人同步') + '</b>' +
      '<span>需要一个免费的 Supabase 项目，2 分钟配好</span></span><span class="ar">›</span></button>' +
      (SYNC.on ? '<button class="linkrow press" data-act="syncNow"><span class="li">🔄</span>' +
        '<span class="lb"><b>立即同步</b><span>手动拉取一次最新数据</span></span><span class="ar">›</span></button>' : '') +
      '</div>' +

      '<div class="pcard"><h3>👤 我的身份</h3><p class="ph2">点菜时会记下是谁点的</p>' +
      '<div class="field" style="margin:0 0 10px"><input id="pName" value="' + esc(S.profile.name) + '" placeholder="你的名字"></div>' +
      '<div class="emojis">' + AVATARS.map(function (em) {
        return '<button class="' + (S.profile.emoji === em ? 'on' : '') + '" data-act="setAvatar" data-em="' + em + '">' + em + '</button>';
      }).join('') + '</div></div>' +

      '<div class="pcard"><h3>📦 数据</h3>' +
      '<button class="linkrow press" data-act="exportJSON"><span class="li">📤</span>' +
      '<span class="lb"><b>导出菜谱</b><span>下载一个 JSON 备份文件</span></span><span class="ar">›</span></button>' +
      '<button class="linkrow press" data-act="importJSON"><span class="li">📥</span>' +
      '<span class="lb"><b>导入菜谱</b><span>从备份文件恢复（同名会按时间取新的）</span></span><span class="ar">›</span></button>' +
      '<button class="linkrow press" data-act="clearAll"><span class="li">🧹</span>' +
      '<span class="lb"><b>清空本机数据</b><span>只清这台设备，不影响其他人</span></span><span class="ar">›</span></button>' +
      '</div>' +

      '<p style="text-align:center;font-size:11.5px;color:#C9B8A6;padding:10px 0 24px">家的菜单 · 两个人一起吃好每一顿</p>';
  }

  // ============================================================
  // 视图：备菜 & 菜单图
  // ============================================================
  function prepData() {
    var ings = {}, seas = {};
    aliveOrders().forEach(function (o) {
      var d = getDish(o.dishId);
      if (!d) return;
      var n = o.qty || 1;
      (d.ingredients || []).forEach(function (it) {
        var k = (it.name || '').trim();
        if (!k) return;
        if (!ings[k]) ings[k] = { name: k, amounts: {}, count: 0 };
        ings[k].count += n;
        if (it.amount) ings[k].amounts[it.amount] = (ings[k].amounts[it.amount] || 0) + n;
      });
      (d.seasonings || []).forEach(function (it) {
        var k = (it.name || '').trim();
        if (!k) return;
        if (!seas[k]) seas[k] = { name: k, amounts: {}, count: 0 };
        seas[k].count += n;
        if (it.amount) seas[k].amounts[it.amount] = (seas[k].amounts[it.amount] || 0) + n;
      });
    });
    function fmt(map) {
      return Object.keys(map).map(function (k) {
        var it = map[k];
        var ams = Object.keys(it.amounts);
        var amount = ams.length === 1 ? ams[0] : (ams.length ? ams.join(' + ') : '');
        return { name: it.name, amount: amount, count: it.count };
      }).sort(function (a, b) { return b.count - a.count; });
    }
    return { ings: fmt(ings), seas: fmt(seas) };
  }

  function openPrep() {
    var p = prepData();
    var ck = S.checks.__prep || {};
    function rows(list) {
      if (!list.length) return '<div class="pi" style="color:#BEAF9F">没有记录</div>';
      return list.map(function (it, i) {
        var k = 'p' + i;
        return '<div class="pi' + (ck[k] ? ' done' : '') + '" data-act="prepTick" data-k="' + k + '">' +
          '<span class="ck">✓</span><span class="nm">' + esc(it.name) + '</span>' +
          '<span class="am">' + esc(it.amount) + '</span></div>';
      }).join('');
    }
    sheet(
      '<div class="sh"><h2>🧺 备菜清单</h2><button class="close" data-act="closeSheet">✕</button></div>' +
      '<div class="sb">' +
      '<div class="prep"><h4>🧺 配菜<em>' + p.ings.length + ' 样</em></h4>' + rows(p.ings) + '</div>' +
      '<div class="prep"><h4>🧂 佐料<em>' + p.seas.length + ' 味</em></h4>' + rows(p.seas) + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:4px">' +
      '<button class="btn-ghost" style="margin:0;flex:1" data-act="copyPrep">📋 复制清单</button>' +
      '<button class="btn-ghost" style="margin:0;flex:1" data-act="resetPrep">重置勾选</button></div>' +
      '<div style="height:14px"></div></div>'
    );
  }

  function viewMeal() {
    var list = aliveOrders();
    if (!list.length) {
      return '<div class="nav"><button class="back" data-act="back">‹</button><div class="title">今日菜单</div>' +
        '<div style="width:38px"></div></div><div class="empty"><div class="ee">🍽</div>' +
        '<p class="et">餐桌上还没有菜</p><p class="es">先去点几道，再生成菜单图</p></div>';
    }
    return '<div class="nav"><button class="back" data-act="back">‹</button><div class="title">今日菜单</div>' +
      '<div style="width:38px"></div></div>' +
      '<div class="menu-preview"><img id="mealImg" alt="今日菜单" src=""></div>' +
      '<div class="actions">' +
      '<button class="btn-primary press" data-act="saveMeal">⬇️ 保存图片</button>' +
      '<button class="btn-ghost press" data-act="shareMeal">📤 分享这张菜单</button>' +
      '<button class="btn-ghost press" data-act="back">返回调整</button></div>';
  }

  function loadImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function drawMeal() {
    var list = aliveOrders().slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var W = 620, PAD = 30, HEAD = 150, ROW = 78;
    var H = HEAD + PAD + list.length * ROW + 90;
    var dpr = Math.min(window.devicePixelRatio || 2, 3);
    var cv = document.createElement('canvas');
    cv.width = W * dpr;
    cv.height = H * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    var imgs = {};
    var jobs = list.map(function (o) {
      if (!o.image) return null;
      return loadImg(o.image).then(function (im) { if (im) imgs[o.id] = im; });
    }).filter(Boolean);

    function paint() {
    // 背景
    ctx.fillStyle = '#F5E9DC';
    ctx.fillRect(0, 0, W, H);

    // 白卡
    var cardX = 20, cardY = 20, cardW = W - 40, cardH = H - 40;
    ctx.save();
    ctx.shadowColor = 'rgba(150,100,60,.18)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.restore();

    // 头部渐变
    ctx.save();
    roundRect(ctx, cardX, cardY, cardW, 110, 24);
    ctx.clip();
    var grd = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + 110);
    grd.addColorStop(0, '#FFA45C');
    grd.addColorStop(1, '#FF5F2E');
    ctx.fillStyle = grd;
    ctx.fillRect(cardX, cardY, cardW, 110);
    ctx.restore();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 26px -apple-system,PingFang SC,sans-serif';
    ctx.fillText('今日菜单', cardX + 26, cardY + 46);
    ctx.font = '400 13px -apple-system,PingFang SC,sans-serif';
    ctx.globalAlpha = .9;
    ctx.fillText(todayStr() + ' · 家的菜单', cardX + 26, cardY + 72);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'right';
    ctx.font = '600 13px -apple-system,PingFang SC,sans-serif';
    ctx.fillText(list.length + ' 道菜', cardX + cardW - 26, cardY + 46);
    ctx.textAlign = 'left';

    // 列表
    var y = cardY + 140;
    list.forEach(function (o, i) {
      var cy = y + i * ROW;
      // 圆形色块
      var c = CAT_MAP[o.category] || CAT_MAP.meat;
      ctx.beginPath();
      ctx.arc(cardX + 48, cy + 26, 26, 0, Math.PI * 2);
      ctx.fillStyle = '#FFF1E6';
      ctx.fill();
      if (imgs[o.id]) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cardX + 48, cy + 26, 26, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(imgs[o.id], cardX + 22, cy, 52, 52);
        ctx.restore();
      } else {
        ctx.font = '26px -apple-system,PingFang SC,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o.emoji || c.emoji, cardX + 48, cy + 28);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }

      ctx.fillStyle = '#33241C';
      ctx.font = '700 20px -apple-system,PingFang SC,sans-serif';
      ctx.fillText(o.name, cardX + 88, cy + 22);

      ctx.fillStyle = '#BEAF9F';
      ctx.font = '400 13px -apple-system,PingFang SC,sans-serif';
      var by = (o.byList || []).map(function (p) { return p.name; }).join('、');
      ctx.fillText(c.name + (by ? ' · ' + by + '点的' : ''), cardX + 88, cy + 44);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#FF6B35';
      ctx.font = '700 17px -apple-system,PingFang SC,sans-serif';
      ctx.fillText('×' + (o.qty || 1), cardX + cardW - 30, cy + 30);
      ctx.textAlign = 'left';

      if (i < list.length - 1) {
        ctx.strokeStyle = '#F3E5D8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cardX + 88, cy + 62);
        ctx.lineTo(cardX + cardW - 30, cy + 62);
        ctx.stroke();
      }
    });

    // 底部
    var fy = cardY + cardH - 46;
    ctx.strokeStyle = '#F3E5D8';
    ctx.beginPath();
    ctx.moveTo(cardX + 26, fy - 20);
    ctx.lineTo(cardX + cardW - 26, fy - 20);
    ctx.stroke();
    ctx.fillStyle = '#BEAF9F';
    ctx.font = '400 13px -apple-system,PingFang SC,sans-serif';
    var totalQty = list.reduce(function (s, o) { return s + (o.qty || 1); }, 0);
    ctx.fillText('共 ' + list.length + ' 道菜 · ' + totalQty + ' 份 · 两个人一起点', cardX + 26, fy);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#D9C9BA';
    ctx.fillText('好好吃饭，慢慢生活', cardX + cardW - 26, fy);
    ctx.textAlign = 'left';
    return cv.toDataURL('image/png');
    }

    return Promise.all(jobs).then(function () {
      paint();
      return cv.toDataURL('image/png');
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ============================================================
  // 弹层
  // ============================================================
  var sheetEl = null, maskEl = null;
  function ensureSheet() {
    if (sheetEl) return;
    maskEl = document.createElement('div');
    maskEl.className = 'sheet-mask';
    maskEl.setAttribute('data-act', 'closeSheet');
    sheetEl = document.createElement('div');
    sheetEl.className = 'sheet';
    document.body.appendChild(maskEl);
    document.body.appendChild(sheetEl);
  }
  function sheet(html) {
    ensureSheet();
    sheetEl.innerHTML = html;
    requestAnimationFrame(function () {
      maskEl.classList.add('on');
      sheetEl.classList.add('on');
    });
  }
  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove('on');
    maskEl.classList.remove('on');
  }

  // ============================================================
  // 动作
  // ============================================================
  function go(page) {
    if (page === 'menu') S.route = { name: 'menu', param: '' };
    else if (page === 'table') S.route = { name: 'table', param: '' };
    else if (page === 'profile') S.route = { name: 'profile', param: '' };
    else if (page === 'meal') S.route = { name: 'meal', param: '' };
    window.scrollTo(0, 0);
    render();
    if (page === 'meal') {
      setTimeout(function () {
        var img = $('#mealImg');
        if (!img) return;
        drawMeal().then(function (src) { img.src = src; });
      }, 30);
    }
  }

  function openDish(id) {
    S.route = { name: 'detail', param: id };
    window.scrollTo(0, 0);
    render();
  }

  function editDish(id) {
    S.editing = id ? clone(getDish(id)) : newDraft();
    S.route = { name: 'edit', param: id || '' };
    window.scrollTo(0, 0);
    render();
  }

  function back() {
    if (S.route.name === 'detail' || S.route.name === 'edit' || S.route.name === 'meal') {
      S.route = { name: 'menu', param: '' };
      S.editing = null;
      render();
    } else {
      history.length > 1 ? history.back() : go('menu');
    }
  }

  function saveDish() {
    var e = S.editing;
    if (!e) return;
    var name = ($('#fName') && $('#fName').value || '').trim();
    if (!name) { toast('给这道菜起个名字吧'); return; }
    var now = Date.now();
    var dish = {
      id: e.id || uid('dish'),
      name: name,
      category: e.category,
      emoji: e.emoji || '🍅',
      image: e.image || '',
      desc: ($('#fDesc') && $('#fDesc').value || '').trim(),
      tags: ($('#fTags') && $('#fTags').value || '').split(/[\s,，、]+/).filter(Boolean).slice(0, 6),
      ingredients: collectRows('ing'),
      seasonings: collectRows('sea'),
      steps: ($('#fSteps') && $('#fSteps').value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      createdAt: e.createdAt || now,
      updatedAt: now,
      deleted: false
    };
    // 图片可能刚换
    dish.image = S.editing.image || '';
    upsertDish(dish);
    S.editing = null;
    toast('已保存');
    S.route = { name: 'detail', param: dish.id };
    render();
  }

  function captureForm() {
    if (!S.editing) return;
    var n = $('#fName'); if (n) S.editing.name = n.value;
    var d = $('#fDesc'); if (d) S.editing.desc = d.value;
    var tg = $('#fTags'); if (tg) S.editing.tags = tg.value.split(/[\s,，、]+/).filter(Boolean);
    var st = $('#fSteps'); if (st) S.editing.steps = st.value.split('\n');
    var ing = $('#rowsIng');
    if (ing && $('.row', ing).length) S.editing.ingredients = collectRows('ing');
    var sea = $('#rowsSea');
    if (sea && $('.row', sea).length) S.editing.seasonings = collectRows('sea');
  }

  function collectRows(kind) {
    var box = kind === 'ing' ? $('#rowsIng') : $('#rowsSea');
    if (!box) return [];
    return $$('.row', box).map(function (row) {
      var nm = $('.nm', row).value.trim();
      var am = $('.am', row).value.trim();
      return nm ? { name: nm, amount: am } : null;
    }).filter(Boolean);
  }

  function deleteDish(id) {
    var d = getDish(id);
    if (!d) return;
    if (!confirm('确定删除「' + d.name + '」吗？')) return;
    d.deleted = true;
    d.updatedAt = Date.now();
    saveDishes();
    pushRows('dishes', [d]);
    S.editing = null;
    toast('已删除');
    go('menu');
  }

  function randomDish() {
    var list = aliveDishes();
    if (!list.length) { toast('还没有菜，先加一道吧'); return; }
    var d = list[Math.floor(Math.random() * list.length)];
    var c = CAT_MAP[d.category] || CAT_MAP.meat;
    sheet('<div class="sh"><h2>🎲 今天就吃这个</h2><button class="close" data-act="closeSheet">✕</button></div>' +
      '<div class="sb" style="text-align:center;padding-bottom:14px">' +
      '<div style="font-size:76px;margin:6px 0 10px">' + (d.image ? '' : esc(d.emoji || c.emoji)) + '</div>' +
      (d.image ? '<img src="' + d.image + '" style="width:180px;height:180px;object-fit:cover;border-radius:20px;margin:0 auto 10px">' : '') +
      '<h2 style="font-size:24px;margin:0 0 6px">' + esc(d.name) + '</h2>' +
      '<p style="font-size:13px;color:#7A6656;margin:0 0 18px">' + esc(d.desc || '') + '</p>' +
      '<button class="btn-primary press" data-act="quickAdd" data-id="' + d.id + '">就它了，加到餐桌</button>' +
      '<button class="btn-ghost press" data-act="random">换一个</button>' +
      '<div style="height:16px"></div></div>');
  }

  function clearOrders() {
    var list = aliveOrders();
    if (!list.length) { toast('餐桌已经是空的'); return; }
    if (!confirm('清空今日餐桌？（不会删除菜品）')) return;
    var now = Date.now();
    list.forEach(function (o) { o.deleted = true; o.updatedAt = now; });
    saveOrders();
    pushRows('orders', list);
    toast('餐桌已清空');
    render();
  }

  function copyText(text, tip) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(tip || '已复制'); })
        .catch(function () { fallbackCopy(text, tip); });
    } else fallbackCopy(text, tip);
  }
  function fallbackCopy(text, tip) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(tip || '已复制'); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

  function openSyncSheet() {
    sheet('<div class="sh"><h2>☁️ 两人同步</h2><button class="close" data-act="closeSheet">✕</button></div>' +
      '<div class="sb">' +
      '<div class="prep"><h4>怎么做</h4>' +
      '<div style="font-size:13px;line-height:1.9;color:#7A6656">' +
      '1. 打开 supabase.com，用 GitHub 或邮箱注册（免费）<br>' +
      '2. 新建项目，等 2 分钟初始化<br>' +
      '3. 左侧 SQL Editor，粘贴项目里的 <b>supabase.sql</b> 执行<br>' +
      '4. Settings → API，复制 <b>Project URL</b> 和 <b>anon key</b><br>' +
      '5. 填到下面，点保存即可' +
      '</div></div>' +
      '<div class="field"><label>Project URL</label>' +
      '<input id="sUrl" placeholder="https://xxxx.supabase.co" value="' + esc(SYNC.url) + '"></div>' +
      '<div class="field"><label>anon key</label>' +
      '<input id="sKey" placeholder="eyJhbGciOi..." value="' + esc(SYNC.key) + '"></div>' +
      '<button class="btn-primary press" data-act="saveSyncCfg">保存并连接</button>' +
      (SYNC.on ? '<button class="btn-ghost press" data-act="disableSync">关闭云端同步</button>' : '') +
      '<p style="font-size:11.5px;color:#BEAF9F;text-align:center;margin-top:14px">' +
      '数据只存在你自己的 Supabase 项目里，不经过任何第三方</p>' +
      '<div style="height:14px"></div></div>');
  }

  function saveSyncCfg() {
    var url = ($('#sUrl').value || '').trim().replace(/\/+$/, '');
    var key = ($('#sKey').value || '').trim();
    if (!url || !key) { toast('两个都要填'); return; }
    if (!/^https?:\/\//.test(url)) { toast('URL 要以 https:// 开头'); return; }
    SYNC.url = url; SYNC.key = key; SYNC.on = true; SYNC.disabled = false; SYNC.lastPull = 0;
    saveSync();
    toast('正在连接…');
    testConnection().then(function (res) {
      closeSheet();
      if (res.warn) toast(res.warn);
      else toast('连接成功，开始同步');
      pull().then(function () { render(); });
      startPolling();
    }).catch(function () {
      toast('连接失败，检查 URL 和 key');
      SYNC.on = false;
      SYNC.url = ''; SYNC.key = '';
      saveSync();
    });
  }

  function disableSync() {
    if (!confirm('关闭后两台手机不再自动同步，本地数据保留。')) return;
    SYNC.url = ''; SYNC.key = ''; SYNC.on = false; SYNC.disabled = true;
    saveSync();
    closeSheet();
    render();
    toast('已关闭同步');
  }

  function exportJSON() {
    var data = {
      app: 'family-menu-web', version: 1, exportedAt: new Date().toISOString(),
      family: S.family, profile: S.profile,
      dishes: aliveDishes(), orders: aliveOrders()
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '家的菜单-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 500);
    toast('已导出');
  }

  function normalizeDish(d) {
    var o = {};
    ['name', 'category', 'emoji', 'desc', 'tags', 'ingredients', 'seasonings', 'steps'].forEach(function (k) {
      if (d[k] !== undefined) o[k] = d[k];
    });
    o.id = d.id || d._id || ('dish_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    if (d.image) o.image = d.image;
    else if (d.img) o.image = 'data:image/' + (d.imgExt || 'jpeg') + ';base64,' + d.img;
    o.category = CAT_MAP[o.category] ? o.category : 'meat';
    o.emoji = o.emoji || '🍽️';
    o.tags = Array.isArray(o.tags) ? o.tags : [];
    o.ingredients = Array.isArray(o.ingredients) ? o.ingredients : [];
    o.seasonings = Array.isArray(o.seasonings) ? o.seasonings : [];
    o.steps = Array.isArray(o.steps) ? o.steps : [];
    o.createdAt = d.createdAt || Date.now();
    o.updatedAt = d.updatedAt || Date.now();
    o.deleted = false;
    return o;
  }

  function importJSON() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          var inc = (data.dishes || []).map(normalizeDish);
          var map = {};
          S.dishes.forEach(function (d) { map[d.id] = d; });
          var add = 0, upd = 0;
          inc.forEach(function (d) {
            var old = map[d.id] || S.dishes.filter(function (x) { return x.name === d.name && !x.deleted; })[0];
            if (old) {
              if ((d.updatedAt || 0) > (old.updatedAt || 0)) { Object.assign(old, d, { id: old.id }); upd++; }
            } else { S.dishes.push(d); add++; }
          });
          saveDishes();
          writeJSON(K.seeded, true);
          pushRows('dishes', S.dishes);
          toast('新增 ' + add + ' 道，更新 ' + upd + ' 道');
          render();
        } catch (e) { toast('文件格式不对'); }
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function clearAll() {
    if (!confirm('清空本机的所有菜品和餐桌？（云端数据不受影响，可以再同步回来）')) return;
    S.dishes = []; S.orders = []; S.checks = {};
    saveDishes(); saveOrders(); writeJSON(K.checks, {});
    toast('已清空');
    go('menu');
  }

  function saveMeal() {
    var img = $('#mealImg');
    if (!img || !img.src) return;
    var a = document.createElement('a');
    a.href = img.src;
    a.download = '今日菜单-' + new Date().toISOString().slice(0, 10) + '.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); }, 300);
    toast('已保存');
  }

  function shareMeal() {
    var img = $('#mealImg');
    if (!img || !img.src) return;
    fetch(img.src).then(function (r) { return r.blob(); }).then(function (blob) {
      var file = new File([blob], '今日菜单.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: '今日菜单', text: '今天吃这些～' });
      }
      toast('这个浏览器不支持分享，请长按保存');
    }).catch(function () { toast('分享失败，请长按保存'); });
  }

  function copyPrep() {
    var p = prepData();
    var lines = ['🧺 配菜'];
    p.ings.forEach(function (it) { lines.push('· ' + it.name + (it.amount ? ' ' + it.amount : '')); });
    lines.push('', '🧂 佐料');
    p.seas.forEach(function (it) { lines.push('· ' + it.name + (it.amount ? ' ' + it.amount : '')); });
    copyText(lines.join('\n'), '清单已复制');
  }

  function resetPrep() {
    S.checks.__prep = {};
    writeJSON(K.checks, S.checks);
    openPrep();
    toast('已重置');
  }

  // ============================================================
  // 事件
  // ============================================================
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');

    switch (act) {
      case 'go': ev.preventDefault(); closeSheet(); go(t.getAttribute('data-page')); break;
      case 'back': ev.preventDefault(); back(); break;
      case 'open': openDish(id); break;
      case 'newDish': editDish(null); break;
      case 'editDish': editDish(id); break;
      case 'saveDish': saveDish(); break;
      case 'delDish': deleteDish(id); break;
      case 'quickAdd': {
        ev.stopPropagation();
        var d = getDish(id);
        if (d) addToTable(d);
        if (t.closest('.sheet')) closeSheet();
        break;
      }
      case 'cat': S.cat = t.getAttribute('data-cat'); render(); break;
      case 'random': closeSheet(); randomDish(); break;
      case 'setCat': captureForm(); S.editing.category = t.getAttribute('data-cat'); render(); break;
      case 'setEmoji': captureForm(); S.editing.emoji = t.getAttribute('data-em'); render(); break;
      case 'setAvatar': captureForm(); S.profile.emoji = t.getAttribute('data-em'); writeJSON(K.profile, S.profile); render(); break;
      case 'clearImage': ev.preventDefault(); ev.stopPropagation(); S.editing.image = ''; $('#coverArea').innerHTML = coverInner(); break;
      case 'addRow': {
        var kind = t.getAttribute('data-kind');
        var box = kind === 'ing' ? $('#rowsIng') : $('#rowsSea');
        var list = kind === 'ing' ? S.editing.ingredients : S.editing.seasonings;
        list.push({ name: '', amount: '' });
        box.insertAdjacentHTML('beforeend', rowsHtml(kind, [list[list.length - 1]]));
        // 重新编号
        $$('.row', box).forEach(function (r, i) {
          r.setAttribute('data-i', i);
          $('.x', r).setAttribute('data-i', i);
        });
        break;
      }
      case 'delRow': {
        var k2 = t.getAttribute('data-kind');
        var box2 = k2 === 'ing' ? $('#rowsIng') : $('#rowsSea');
        var rows = $$('.row', box2);
        if (rows.length <= 1) {
          rows[0].querySelector('.nm').value = '';
          rows[0].querySelector('.am').value = '';
          break;
        }
        t.closest('.row').remove();
        $$('.row', box2).forEach(function (r, i) {
          r.setAttribute('data-i', i);
          $('.x', r).setAttribute('data-i', i);
        });
        break;
      }
      case 'inc': { var o = S.orders.filter(function (x) { return x.id === id; })[0]; if (o) { o.qty = (o.qty || 1) + 1; o.updatedAt = Date.now(); upsertOrder(o); render(); } break; }
      case 'dec': {
        var o2 = S.orders.filter(function (x) { return x.id === id; })[0];
        if (o2) {
          o2.qty = (o2.qty || 1) - 1;
          o2.updatedAt = Date.now();
          if (o2.qty <= 0) { o2.deleted = true; }
          upsertOrder(o2);
          render();
        }
        break;
      }
      case 'clearOrders': clearOrders(); break;
      case 'openPrep': openPrep(); break;
      case 'closeSheet': closeSheet(); break;
      case 'prepTick': {
        var k = t.getAttribute('data-k');
        S.checks.__prep = S.checks.__prep || {};
        S.checks.__prep[k] = !S.checks.__prep[k];
        writeJSON(K.checks, S.checks);
        t.classList.toggle('done');
        break;
      }
      case 'copyPrep': copyPrep(); break;
      case 'resetPrep': resetPrep(); break;
      case 'tick': {
        var key = t.getAttribute('data-key'), kk = t.getAttribute('data-k');
        S.checks[key] = S.checks[key] || {};
        S.checks[key][kk] = !S.checks[key][kk];
        writeJSON(K.checks, S.checks);
        t.classList.toggle('done');
        break;
      }
      case 'saveMeal': saveMeal(); break;
      case 'shareMeal': shareMeal(); break;
      case 'copyCode': copyText(S.family.id, '家庭码已复制'); break;
      case 'shareLink': {
        var link = location.origin + location.pathname + '?f=' + S.family.id;
        copyText(link, '邀请链接已复制，发给另一半吧');
        break;
      }
      case 'openSync': openSyncSheet(); break;
      case 'saveSyncCfg': saveSyncCfg(); break;
      case 'disableSync': disableSync(); break;
      case 'syncNow': toast('同步中…'); pull().then(function () { toast('已同步'); }); break;
      case 'exportJSON': exportJSON(); break;
      case 'importJSON': importJSON(); break;
      case 'clearAll': clearAll(); break;
    }
  });

  // 输入
  document.addEventListener('input', function (ev) {
    var id = ev.target.id;
    if (id === 'qInput') {
      S.q = ev.target.value;
      clearTimeout(S._qt);
      S._qt = setTimeout(function () {
        var val = S.q;
        render();
        var el = $('#qInput');
        if (el) { el.value = val; el.focus(); }
      }, 180);
    } else if (id === 'pName') {
      S.profile.name = ev.target.value.trim() || '我';
      writeJSON(K.profile, S.profile);
      var nm = $('.phero .nm');
      if (nm) nm.textContent = S.profile.name;
    }
  });

  // 路由 / 启动
  function boot() {
    load();
    seedIfEmpty();

    // 邀请链接
    var m = /[?&]f=([A-Z0-9]{6,12})/i.exec(location.search);
    if (m) {
      var code = m[1].toUpperCase();
      if (code !== S.family.id) {
        S.family = { id: code, name: '我们的小家', createdAt: Date.now() };
        writeJSON(K.family, S.family);
        toast('已加入小家 ' + code);
      }
    }

    render();
    if (SYNC.on) {
      if (!SYNC.lastPull) {
        pushRows('dishes', S.dishes).then(function () {
          return pushRows('orders', S.orders);
        }).then(function () { setTimeout(pull, 400); });
      } else {
        pull();
      }
      startPolling();
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && SYNC.on) pull();
    });
    window.addEventListener('hashchange', render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
