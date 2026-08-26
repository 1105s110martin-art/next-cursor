import { CONTACTS, TAG_POOL, STAGES, NOISE_LINES, ENDINGS, HELP_ITEMS } from './data.js'

/* ================= 配置 ================= */
const DEFAULTS = {
  resistance: { dragThreshold:40, holdLabelMs:700, holdRemoveMs:1200, startStrength:6, costLabel:1, costReorder:1, costRemove:2 },
  climax: { holdSeconds:6 },
  pacing: { typeSpeed:34 },
  audio: { bgmVolume:0.4, ambientVolume:0.3, noiseVolume:0.55 },
  ending: { leaveThreshold:7, pauseThreshold:3 },
}
const CFG = structuredClone(DEFAULTS)
function mergeCfg(src){
  if (!src) return
  for (const g of Object.keys(DEFAULTS)) {
    if (src[g]) Object.assign(CFG[g], src[g])
  }
}
mergeCfg(window.__museGameConfig)
window.addEventListener('muse:config-updated', e => { mergeCfg(e.detail); applyConfig() })
function applyConfig(){
  if (audio.bgm) audio.bgm.volume = CFG.audio.bgmVolume
  if (audio.amb) audio.amb.volume = CFG.audio.ambientVolume
  if (audio.noise) audio.noise.volume = S.noiseAudible ? CFG.audio.noiseVolume : 0
  renderStrength()
}

/* ================= 工具 ================= */
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const wait = ms => new Promise(r => setTimeout(r, ms))
const show = el => el.classList.add('show')
const hide = el => el.classList.remove('show')

const ROW_H = 100

/* ================= 状态 ================= */
const S = {
  stage: -1,
  contacts: [],
  strength: 6,
  deviation: 0,
  compliance: 0,
  todoDone: [],
  memoriesSeen: [],
  keyMemDone: false,
  busy: false,
  noiseAudible: false,
  taughtHold: false,
  taughtStrength: false,
}

/* ================= 音频 ================= */
const audio = { bgm:null, amb:null, noise:null, started:false }
function initAudio(){
  if (audio.started) return
  audio.started = true
  audio.bgm = new Audio('assets/audio/bgm.wav')
  audio.bgm.loop = true; audio.bgm.volume = CFG.audio.bgmVolume
  audio.amb = new Audio('assets/audio/amb-city.wav')
  audio.amb.loop = true; audio.amb.volume = CFG.audio.ambientVolume
  audio.noise = new Audio('assets/audio/amb-voices.wav')
  audio.noise.loop = true; audio.noise.volume = 0
  ;[audio.bgm, audio.amb, audio.noise].forEach(a => a.play().catch(()=>{}))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      [audio.bgm, audio.amb, audio.noise].forEach(a => a && a.paused && a.play().catch(()=>{}))
    }
  })
}

/* ================= 视口适配 ================= */
function fit(){
  const s = Math.min(innerWidth / 720, innerHeight / 1280)
  $('#stage').style.transform = `translate(-50%,-50%) scale(${s})`
}
addEventListener('resize', fit); fit()

/* ================= 环境层 ================= */
let envSlot = 0
function setEnv(name){
  const slots = [$('#env-a'), $('#env-b')]
  const next = slots[envSlot ^ 1]
  next.style.backgroundImage = `url(assets/backgrounds/${name}.jpg)`
  next.classList.add('on')
  slots[envSlot].classList.remove('on')
  envSlot ^= 1
}

/* ================= 力气 ================= */
function renderStrength(){
  const box = $('#sb-strength')
  const total = CFG.resistance.startStrength
  box.innerHTML = ''
  for (let i = 0; i < total; i++) {
    const img = document.createElement('img')
    const spent = i >= S.strength
    img.src = spent ? 'assets/items/match-spent.png' : 'assets/items/match.png'
    if (spent) img.classList.add('spent')
    box.appendChild(img)
  }
}
function spendStrength(n){
  S.strength = Math.max(0, S.strength - n)
  renderStrength()
  if (!S.taughtStrength && n > 0) {
    S.taughtStrength = true
    floatNote('这是今天的力气。偏离默认，要花掉一点。')
  }
}

/* 手写体瞬态提示 */
function floatNote(text){
  const el = document.createElement('div')
  el.textContent = text
  Object.assign(el.style, {
    position:'absolute', left:'26px', right:'26px', top:'112px', zIndex:70,
    fontFamily:'var(--hand)', fontSize:'24px', color:'var(--red)',
    textAlign:'right', pointerEvents:'none', opacity:'0',
    transition:'opacity .5s ease, transform .5s ease', transform:'translateY(8px)',
  })
  $('#phone-screen').appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none' })
  setTimeout(() => { el.style.opacity = '0' }, 2600)
  setTimeout(() => el.remove(), 3300)
}

/* ================= 页标 ================= */
const PAGES = [
  { id:'page-todo',  label:'待办' },
  { id:'page-list',  label:'联系人' },
  { id:'page-album', label:'相册' },
]
function buildTabs(){
  const box = $('#pagetabs'); box.innerHTML = ''
  PAGES.forEach(p => {
    const b = document.createElement('button')
    b.className = 'tab'; b.textContent = p.label; b.dataset.page = p.id
    b.addEventListener('click', () => gotoPage(p.id))
    box.appendChild(b)
  })
}
function gotoPage(id){
  $$('.page').forEach(p => p.classList.toggle('active', p.id === id))
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === id))
  if (id === 'page-album') renderAlbum()
}

/* ================= 待办（默认路径） ================= */
function renderTodos(){
  const st = STAGES[S.stage]
  $('#page-todo .page-title').innerHTML = `${st.title}<small>顺着做，最省力</small>`
  const ul = $('#todo-list'); ul.innerHTML = ''
  st.todos.forEach((t, i) => {
    const li = document.createElement('li')
    li.textContent = t.text
    const n = document.createElement('span')
    n.className = 'auto-note'; n.textContent = t.auto
    li.appendChild(n)
    if (S.todoDone[i]) li.classList.add('done')
    ul.appendChild(li)
  })
  const remaining = st.todos.some((_, i) => !S.todoDone[i])
  $('#follow-btn').classList.toggle('gone', !remaining)
}
async function followOne(){
  if (S.busy) return
  const st = STAGES[S.stage]
  const idx = st.todos.findIndex((_, i) => !S.todoDone[i])
  if (idx < 0) return
  S.todoDone[idx] = true
  S.compliance++
  const li = $('#todo-list').children[idx]
  li.classList.add('done')
  renderTodos()
  await wait(700)
  if (!st.todos.some((_, i) => !S.todoDone[i])) endStage()
}

/* ================= 联系人列表 ================= */
function resetContacts(){
  S.contacts = CONTACTS.map(c => ({ ...c, removed:false, edited:false }))
}
function renderContacts(){
  const ul = $('#contact-list'); ul.innerHTML = ''
  S.contacts.forEach((c, i) => {
    const li = document.createElement('li')
    li.className = 'crow'
    li.dataset.id = c.id
    li.style.transform = `translateY(${i * ROW_H}px)`
    li.innerHTML = `
      <span class="cname">${c.name}</span>
      <span class="cnote">${c.note}</span>
      <span class="ctag ${i % 2 ? 't-blue' : 't-pink'}">${c.tag}</span>
      <span class="hold-ring"></span>`
    if (c.removed) li.classList.add('removed')
    attachRow(li)
    ul.appendChild(li)
  })
  // 新手指引箭头：第一阶段、还没学过长按时，给关键联系人加一枚手写箭头
  if (!S.taughtHold) {
    const key = STAGES[S.stage]?.id
    const row = ul.querySelector(`.crow[data-id="${key}"]`)
    if (row) {
      const a = document.createElement('span')
      a.className = 'hint-arrow'; a.textContent = '→'
      row.appendChild(a)
    }
  }
}
function reflowRows(){
  $$('#contact-list .crow').forEach(row => {
    if (row.classList.contains('dragging')) return
    const i = S.contacts.findIndex(c => c.id === row.dataset.id)
    if (i >= 0) row.style.transform = `translateY(${i * ROW_H}px)`
  })
}

/* --- 每行的点击 / 长按 / 拖拽 --- */
function attachRow(row){
  let holdTimer = null, rafId = null
  let startY = 0, startIdx = 0, moved = false, dragging = false, holdStart = 0
  let holdStageDone = 0 // 0 none, 1 label, 2 remove
  const ring = () => row.querySelector('.hold-ring')

  const clearHold = () => {
    if (holdTimer) { cancelAnimationFrame(holdTimer); holdTimer = null }
    row.classList.remove('holding')
    ring().style.background = 'conic-gradient(var(--red) 0turn, rgba(0,0,0,0) 0turn)'
  }

  function onDown(e){
    if (S.busy) return
    row.setPointerCapture?.(e.pointerId)
    startY = e.clientY; moved = false; dragging = false; holdStageDone = 0
    startIdx = S.contacts.findIndex(c => c.id === row.dataset.id)
    holdStart = performance.now()
    row.classList.add('holding')
    const tick = () => {
      if (dragging) { clearHold(); return }
      const t = performance.now() - holdStart
      const p = Math.min(1, t / CFG.resistance.holdRemoveMs)
      ring().style.background = `conic-gradient(var(--red) ${p}turn, rgba(0,0,0,0) ${p}turn)`
      if (holdStageDone < 1 && t >= CFG.resistance.holdLabelMs) {
        holdStageDone = 1
        doChangeTag(row)
      }
      if (holdStageDone < 2 && t >= CFG.resistance.holdRemoveMs) {
        holdStageDone = 2
        $('#drop-remove').classList.add('on')
        floatNote('松手前拖到底部，就能把她移出去。')
      }
      holdTimer = requestAnimationFrame(tick)
    }
    holdTimer = requestAnimationFrame(tick)
    row.addEventListener('pointermove', onMove)
    row.addEventListener('pointerup', onUp)
    row.addEventListener('pointercancel', onUp)
  }

  function onMove(e){
    const dy = e.clientY - startY
    if (Math.abs(dy) > 6) moved = true
    if (!dragging && Math.abs(dy) > CFG.resistance.dragThreshold * 0.35) {
      dragging = true
      clearHold()
      row.classList.add('dragging')
    }
    if (dragging) {
      const scale = getScale()
      row.style.transform = `translateY(${startIdx * ROW_H + dy / scale}px) rotate(${dy > 0 ? 1 : -1}deg)`
      const dz = $('#drop-remove')
      if (dz.classList.contains('on')) {
        const r = dz.getBoundingClientRect()
        dz.classList.toggle('hot', e.clientY > r.top)
      }
    }
  }

  async function onUp(e){
    row.removeEventListener('pointermove', onMove)
    row.removeEventListener('pointerup', onUp)
    row.removeEventListener('pointercancel', onUp)
    clearHold()
    const dz = $('#drop-remove')
    const droppedOnRemove = dz.classList.contains('on') && dz.classList.contains('hot')
    dz.classList.remove('on', 'hot')

    if (dragging) {
      row.classList.remove('dragging')
      const dy = (e.clientY - startY) / getScale()
      if (droppedOnRemove && holdStageDone >= 2) {
        doRemove(row)
      } else if (Math.abs(dy) >= CFG.resistance.dragThreshold) {
        const shift = Math.round(dy / ROW_H)
        if (shift !== 0) doReorder(row, startIdx, shift)
        else reflowRows()
      } else {
        reflowRows() // 回弹
      }
      return
    }
    if (!moved && holdStageDone === 0) openContact(row.dataset.id)
  }

  row.addEventListener('pointerdown', onDown)
}
function getScale(){ return Math.min(innerWidth / 720, innerHeight / 1280) }

function markTaughtHold(){
  if (S.taughtHold) return
  S.taughtHold = true
  $$('.hint-arrow').forEach(a => a.remove())
  floatNote('偏离一次，要花掉一点力气。')
}

async function confirmIfExhausted(){
  if (S.strength > 0) return true
  floatNote('已经没什么力气了。再确认一遍。')
  return true
}

async function doChangeTag(row){
  const c = S.contacts.find(x => x.id === row.dataset.id)
  if (!c) return
  await confirmIfExhausted()
  const i = TAG_POOL.indexOf(c.tag)
  c.tag = TAG_POOL[(i + 1) % TAG_POOL.length]
  c.edited = true
  const tag = row.querySelector('.ctag')
  tag.textContent = c.tag
  tag.classList.remove('changed'); void tag.offsetWidth; tag.classList.add('changed')
  registerDeviation(CFG.resistance.costLabel, c)
  markTaughtHold()
}

function doReorder(row, fromIdx, shift){
  const to = Math.max(0, Math.min(S.contacts.length - 1, fromIdx + shift))
  const [c] = S.contacts.splice(fromIdx, 1)
  S.contacts.splice(to, 0, c)
  c.edited = true
  reflowRows()
  registerDeviation(CFG.resistance.costReorder, c)
  markTaughtHold()
}

function doRemove(row){
  const id = row.dataset.id
  const c = S.contacts.find(x => x.id === id)
  if (!c) return
  row.classList.add('gone')
  setTimeout(() => {
    S.contacts = S.contacts.filter(x => x.id !== id)
    renderContacts()
  }, 380)
  registerDeviation(CFG.resistance.costRemove, c)
  markTaughtHold()
}

function registerDeviation(cost, contact){
  spendStrength(cost)
  S.deviation += Math.max(1, cost)
  // 偏离动作作用在本阶段的关键人物上时，触发她的回忆
  const st = STAGES[S.stage]
  if (contact && contact.id === st.id && !S.keyMemDone) {
    S.keyMemDone = true
    setTimeout(() => playMemory(st.memories[0]), 500)
  }
}

async function openContact(id){
  const st = STAGES[S.stage]
  if (id === st.id) {
    if (!S.keyMemDone) { S.keyMemDone = true; playMemory(st.memories[0]); return }
    floatNote('她说的话，你已经听过了。')
    return
  }
  const c = S.contacts.find(x => x.id === id)
  floatNote(SIDE_LINES[id] || `${c?.name || ''}：没什么新消息。`)
}
const SIDE_LINES = {
  fiance: '陈叙：场地那边都定了，你别操心。',
  mom:    '妈妈：三条语音，你还没点开。',
  dad:    '爸爸：转发了《婚后如何相处》。',
  bestie: '小满：你真的想结吗？（撤回了）',
  work:   '主管：婚假批了，回来就交年报。',
  friend: '林知：那边现在是凌晨四点。',
  boss:   '老板娘：辣酱给你留了一瓶。',
}

/* ================= 回忆 ================= */
async function playMemory(mem){
  if (!mem || S.busy) return
  S.busy = true
  const art = $('#mem-art')
  art.style.backgroundImage = `url(assets/backgrounds/${mem.art}.jpg)`
  art.classList.remove('in'); void art.offsetWidth; art.classList.add('in')
  const box = $('#mem-text'); box.innerHTML = ''
  show($('#memory'))
  await wait(500)

  for (const line of mem.lines) {
    const p = document.createElement('p')
    box.appendChild(p)
    $$('#mem-text p').forEach((el, i, arr) => el.classList.toggle('dim', i < arr.length - 1))
    await typeInto(p, line)
    await waitClick()
  }
  if (!S.memoriesSeen.includes(mem.key)) S.memoriesSeen.push(mem.key)
  hide($('#memory'))
  await wait(450)
  S.busy = false
}
function typeInto(el, text){
  return new Promise(res => {
    let i = 0
    const step = () => {
      el.textContent = text.slice(0, ++i)
      if (i >= text.length) return res()
      setTimeout(step, CFG.pacing.typeSpeed)
    }
    step()
  })
}
function waitClick(){
  return new Promise(res => {
    const h = () => { $('#memory').removeEventListener('pointerdown', h); res() }
    $('#memory').addEventListener('pointerdown', h)
  })
}

/* ================= 相册 ================= */
const ALBUM_ORDER = ['boss','boss2','friend','friend2','mom','mom2']
const ALBUM_ART = { boss:'mem-boss-1', boss2:'mem-boss-2', friend:'mem-friend-1', friend2:'mem-friend-2', mom:'mem-mom-1', mom2:'mem-mom-2' }
function renderAlbum(){
  const g = $('#album-grid'); g.innerHTML = ''
  if (!S.memoriesSeen.length) {
    const p = document.createElement('p')
    p.className = 'album-empty'
    p.textContent = '还没有存下什么。'
    g.appendChild(p); return
  }
  ALBUM_ORDER.forEach(k => {
    const d = document.createElement('div')
    d.className = 'shot'
    if (S.memoriesSeen.includes(k)) {
      d.style.backgroundImage = `url(assets/backgrounds/${ALBUM_ART[k]}.jpg)`
      d.addEventListener('click', () => {
        const mem = STAGES.flatMap(s => s.memories).find(m => m.key === k)
        playMemory(mem)
      })
    } else d.classList.add('locked')
    g.appendChild(d)
  })
}

/* ================= 关键一问 ================= */
function askQuestion(q){
  return new Promise(res => {
    $('#q-text').textContent = q.text
    const box = $('#q-choices'); box.innerHTML = ''
    const mk = (opt, hard) => {
      const b = document.createElement('button')
      b.className = 'qbtn' + (hard ? ' hard' : '')
      b.innerHTML = `${opt.label}${hard ? '<span class="cost">要花一点力气</span>' : '<span class="cost">不用多想</span>'}`
      b.addEventListener('click', async () => {
        hide($('#question'))
        if (hard) { S.deviation += 2; spendStrength(1) } else S.compliance++
        await wait(400)
        floatNote(opt.line)
        await wait(2200)
        res()
      })
      box.appendChild(b)
    }
    mk(q.accept, false)
    mk(q.speak, true)
    show($('#question'))
  })
}

/* ================= 幕间 ================= */
async function interlude(text){
  $('#il-text').textContent = text
  show($('#interlude'))
  await wait(3000)
  hide($('#interlude'))
  await wait(700)
}

/* ================= 高潮段落 ================= */
function playClimax(){
  return new Promise(res => {
    S.busy = true
    const noise = $('#cx-noise'); noise.innerHTML = ''
    const nodes = []
    NOISE_LINES.forEach((t, i) => {
      const el = document.createElement('span')
      el.className = 'nz'; el.textContent = t
      const ang = (i / NOISE_LINES.length) * Math.PI * 2
      el.style.left = `${50 + Math.cos(ang) * 32}%`
      el.style.top = `${50 + Math.sin(ang) * 30}%`
      el.style.fontSize = `${22 + (i % 4) * 5}px`
      el.style.opacity = '0'
      noise.appendChild(el); nodes.push(el)
    })
    show($('#climax'))
    $('#stage').classList.add('climaxing')
    $('#env-layer').classList.add('focus')
    S.noiseAudible = true
    if (audio.noise) audio.noise.volume = CFG.audio.noiseVolume
    nodes.forEach((el, i) => setTimeout(() => {
      el.style.opacity = '.85'
      el.style.transform = `scale(${1 + (i % 3) * .18})`
    }, 300 + i * 220))

    const arc = $('#cx-arc'), LEN = 276.5
    let holding = false, t0 = 0, raf = null, hushed = 0, done = false

    const onDown = () => { if (done) return; holding = true; t0 = performance.now(); loop() }
    const onUp = () => {
      if (done) return
      holding = false
      cancelAnimationFrame(raf)
      arc.style.strokeDashoffset = LEN
      nodes.forEach(n => n.classList.remove('hush'))
      hushed = 0
      if (audio.noise) audio.noise.volume = CFG.audio.noiseVolume
      $('#cx-hint').textContent = '声音又回来了。按住不放。'
    }
    const loop = () => {
      if (!holding) return
      const p = Math.min(1, (performance.now() - t0) / (CFG.climax.holdSeconds * 1000))
      arc.style.strokeDashoffset = LEN * (1 - p)
      const want = Math.floor(p * nodes.length)
      while (hushed < want) { nodes[hushed].classList.add('hush'); hushed++ }
      if (audio.noise) audio.noise.volume = CFG.audio.noiseVolume * (1 - p)
      if (audio.amb) audio.amb.volume = CFG.audio.ambientVolume * (1 - p * .9)
      if (p >= 1) { finish(); return }
      raf = requestAnimationFrame(loop)
    }
    async function finish(){
      done = true
      cancelAnimationFrame(raf)
      nodes.forEach(n => n.classList.add('hush'))
      S.noiseAudible = false
      if (audio.noise) audio.noise.volume = 0
      $('#cx-hint').textContent = ''
      $('#cx-q').textContent = '那我呢？'
      await wait(1400)
      $('#cx-q').innerHTML = '<span class="final-cursor">｜</span>'
      await wait(1600)
      hide($('#climax'))
      $('#stage').classList.remove('climaxing')
      $('#env-layer').classList.remove('focus')
      if (audio.amb) audio.amb.volume = CFG.audio.ambientVolume
      $('#climax').removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      S.busy = false
      res()
    }
    $('#cx-hint').textContent = '按住不放'
    $('#climax').addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
  })
}

/* ================= 流程 ================= */
async function startStage(i){
  S.stage = i
  const st = STAGES[i]
  S.strength = CFG.resistance.startStrength
  S.todoDone = st.todos.map(() => false)
  S.keyMemDone = false
  renderStrength()
  await interlude(st.opening)
  setEnv(st.env)
  renderTodos()
  renderContacts()
  gotoPage('page-todo')
  if (i === 0) {
    await wait(900)
    floatNote('什么都不动，点"照着做"就行。')
  }
}
async function endStage(){
  const st = STAGES[S.stage]
  S.busy = true
  await wait(500)
  S.busy = false
  // 第二段回忆
  if (!S.memoriesSeen.includes(st.memories[1].key)) await playMemory(st.memories[1])
  if (!S.memoriesSeen.includes(st.memories[0].key)) await playMemory(st.memories[0])
  await askQuestion(st.question)
  if (S.stage < STAGES.length - 1) {
    await startStage(S.stage + 1)
  } else {
    setEnv('env-wedding')
    await wait(1200)
    await playClimax()
    await runEnding()
  }
}

function pickEnding(){
  if (S.deviation >= CFG.ending.leaveThreshold) return 'leave'
  if (S.deviation >= CFG.ending.pauseThreshold) return 'pause'
  return 'continue'
}
async function runEnding(){
  const key = pickEnding()
  const ed = ENDINGS[key]
  $('#ed-art').style.backgroundImage = `url(assets/backgrounds/${ed.art}.jpg)`
  const box = $('#ed-text'); box.innerHTML = ''
  show($('#ending'))
  await wait(200)
  $('#ending').classList.add('lit')
  await wait(1400)
  for (const line of ed.lines) {
    const p = document.createElement('p')
    box.appendChild(p)
    await typeInto(p, line)
    await wait(700)
  }
  await wait(500)
  const f = document.createElement('p')
  f.className = 'stamp'
  if (ed.stamp) f.textContent = ed.stamp
  else if (key === 'pause') f.innerHTML = '接下来<span class="final-cursor">｜</span>'
  else f.innerHTML = '<span class="final-cursor">｜</span>'
  box.appendChild(f)
}

/* ================= 帮助层 ================= */
function buildHelp(){
  const b = $('#help-body'); b.innerHTML = ''
  HELP_ITEMS.forEach(it => {
    const d = document.createElement('div')
    d.className = 'hrow'
    d.innerHTML = `<b>${it.k}</b><span>${it.v}</span>`
    b.appendChild(d)
  })
}

/* ================= 启动 ================= */
function bind(){
  $('#start-btn').addEventListener('click', async () => {
    initAudio()
    hide($('#title'))
    await wait(600)
    resetContacts()
    await startStage(0)
  })
  $('#follow-btn').addEventListener('click', followOne)
  $('#help-btn').addEventListener('click', () => show($('#help')))
  $('#help-close').addEventListener('click', () => hide($('#help')))
  $('#help').addEventListener('pointerdown', e => { if (e.target.id === 'help') hide($('#help')) })
  $('#restart-btn').addEventListener('click', () => location.reload())
  const clock = () => {
    const d = new Date()
    $('#sb-time').textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
  clock(); setInterval(clock, 20000)
}
// 内部调试入口（不在正式流程中暴露）
window.__dbg = {
  jump: async (i, dev = 0) => {
    initAudio(); hide($('#title')); resetContacts()
    S.deviation = dev
    await startStage(i)
  },
  endStage, playClimax, runEnding, S, CFG,
}

buildTabs(); buildHelp(); bind(); renderStrength()
setEnv('env-engagement')
