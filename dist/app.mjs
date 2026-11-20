import { initial, addEntry, changeEntry, pathFor, commands, execute } from './engine.mjs';
import { exercises } from './exercises.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'docker-playground-v1';
const dockerfile = '/workspace/Dockerfile';
const createModel = () => ({ main: initial(), scenario: null, activeScenario: false, exercise: 'web', selected: dockerfile, completed: {} });
let model = createModel();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved?.main?.files && Object.hasOwn(exercises, saved.exercise)) model = saved;
} catch { /* A fresh workspace remains available when storage cannot be read. */ }
let selected = model.selected;
let history = [], historyIndex = 0, noticeTimer;
let fileMode;
const state = () => model.activeScenario ? model.scenario : model.main;
const entries = () => state().files;
const draftExists = path => Object.hasOwn(state().drafts, path);
const labelOf = path => path.split('/').at(-1);
const text = (id, value) => { $(id).textContent = value; };

function notice(message) {
  text('notice', message);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => text('notice', ''), 3500);
}
function persist() {
  model.selected = selected;
  try { localStorage.setItem(storageKey, JSON.stringify(model)); }
  catch { notice('浏览器存储不可用，刷新后可能丢失本次编辑。'); }
}
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function button(content, action, className) {
  const node = element('button', content, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function renderContainers() {
  const { containers } = state();
  text('counts', containers.filter(c => c.running).length + ' 运行中 / ' + containers.length + ' 个容器');
  const rows = containers.map(container => {
    const row = element('tr');
    const name = element('td');
    name.append(button(container.name, () => {
      text('container-name', container.name);
      text('container-id', '短 ID · ' + container.id);
      text('container-logs', container.logs.join('\n'));
      $('container-dialog').showModal();
    }, 'name'));
    const status = element('td');
    status.append(element('span', container.running ? '运行中' : '已停止', container.running ? 'status running' : 'status'));
    row.append(name, element('td', container.image.tag), status, element('td', container.port?.join(' → ') || '—'));
    return row;
  });
  if (!rows.length) {
    const row = element('tr');
    const empty = element('td', '暂无容器。运行 docker run 后，容器会显示在这里。', 'empty');
    empty.colSpan = 4;
    row.append(empty);
    rows.push(row);
  }
  $('containers').replaceChildren(...rows);
}
function renderFiles() {
  const files = entries();
  if (!files[selected]) selected = files[dockerfile] ? dockerfile : '/workspace';
  const buttons = Object.keys(files).sort().map(path => {
    const item = button(undefined, () => {
      selected = path;
      renderFiles();
      persist();
      [...$('file-tree').children].find(node => node.dataset.path === path)?.focus();
    });
    item.dataset.path = path;
    item.title = path;
    const depth = path.split('/').length - 2;
    item.style.paddingInlineStart = (7 + depth * 12) + 'px';
    item.setAttribute('aria-current', String(path === selected));
    const icon = element('span', files[path].type === 'dir' ? '▸' : '▤');
    icon.setAttribute('aria-hidden', 'true');
    item.append(icon, element('span', labelOf(path) + (files[path].type === 'dir' ? '/' : '')));
    return item;
  });
  $('file-tree').replaceChildren(...buttons);
  const file = files[selected].type === 'file';
  $('text').disabled = !file;
  $('text').value = file ? state().drafts[selected] ?? files[selected].content : '';
  $('text').placeholder = file ? '' : '选择一个文件开始编辑';
  $('remove').disabled = $('rename').disabled = selected === '/workspace';
  renderFilename();
}
function renderFilename() {
  const dirty = draftExists(selected);
  text('filename', labelOf(selected) + (dirty ? ' •' : ''));
  $('save').disabled = !dirty;
  text('line-numbers', $('text').value.split('\n').map((_, index) => index + 1).join('\n'));
  $('line-numbers').scrollTop = $('text').scrollTop;
}
function renderExercise() {
  const exercise = exercises[model.exercise];
  const current = exercise.steps(state(), model.activeScenario);
  $('exercise').value = model.exercise;
  text('exercise-title', exercise.title + (model.completed[model.exercise] ? ' · 已完成' : ''));
  text('goal', exercise.goal);
  $('steps').replaceChildren(...current.map(({ label, done }) => {
    const item = element('li', undefined, done ? 'step done' : 'step');
    const sign = element('span', done ? '✓' : '○');
    sign.setAttribute('aria-label', done ? '通过' : '待完成');
    item.append(sign, element('span', label));
    return item;
  }));
  $('hint-list').replaceChildren(...exercise.hints.map(hint => element('li', hint)));
  $('scenario').hidden = model.activeScenario || model.exercise !== 'conflict';
  $('leave').hidden = !model.activeScenario;
}
function output(message, className) {
  if (!message) return;
  $('output').append(element('div', message, className));
  $('output').scrollTop = $('output').scrollHeight;
}
function render() {
  renderContainers();
  renderFiles();
  renderExercise();
  text('prompt', state().cwd + ' $');
}
function saveFile() {
  if (!draftExists(selected)) return;
  entries()[selected].content = state().drafts[selected];
  delete state().drafts[selected];
  renderFilename();
  text('result', '');
  renderExercise();
  persist();
  notice('已保存 ' + labelOf(selected));
}
$('text').addEventListener('input', () => {
  const value = $('text').value;
  if (value === entries()[selected].content) delete state().drafts[selected];
  else state().drafts[selected] = value;
  renderFilename();
  persist();
});
$('text').addEventListener('scroll', () => { $('line-numbers').scrollTop = $('text').scrollTop; });
$('save').addEventListener('click', saveFile);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveFile();
  }
});
function showFileForm(mode) {
  fileMode = mode;
  const create = mode === 'create';
  text('file-dialog-title', create ? '新建文件或目录' : '重命名');
  text('file-error', '');
  $('entry-type-label').hidden = $('entry-type').hidden = !create;
  const folder = entries()[selected].type === 'dir' ? selected : selected.slice(0, selected.lastIndexOf('/'));
  $('entry-path').value = create ? folder + '/' : selected;
  $('file-dialog').showModal();
  $('entry-path').focus();
  const end = $('entry-path').value.length;
  $('entry-path').setSelectionRange(create ? end : selected.lastIndexOf('/') + 1, end);
}
$('create').addEventListener('click', () => showFileForm('create'));
$('rename').addEventListener('click', () => showFileForm('rename'));
$('cancel-file').addEventListener('click', () => $('file-dialog').close());
$('file-form').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const path = pathFor(state(), $('entry-path').value.trim());
    if (fileMode === 'create') addEntry(state(), path, $('entry-type').value);
    else changeEntry(state(), selected, path);
    selected = path;
    $('file-dialog').close();
    render();
    persist();
  } catch (error) { text('file-error', error.message); }
});
$('remove').addEventListener('click', () => {
  if (!confirm('删除 ' + selected + '？目录中的文件及其草稿也会被删除。')) return;
  const previous = selected;
  changeEntry(state(), previous);
  selected = previous.slice(0, previous.lastIndexOf('/'));
  render();
  persist();
});
$('clear').addEventListener('click', () => { $('output').replaceChildren(); $('command').focus(); });
$('command-form').addEventListener('submit', e => {
  e.preventDefault();
  const command = $('command').value.trim();
  if (!command) return;
  history.push(command);
  historyIndex = history.length;
  $('command').value = '';
  output('$ ' + command, 'shell-command');
  try {
    const result = execute(state(), command);
    if (result === null) $('output').replaceChildren();
    else output(result);
  } catch (error) { output(error.message, 'error'); }
  text('result', '');
  render();
  persist();
  $('command').focus();
});
$('command').addEventListener('keydown', e => {
  if (!['ArrowUp', 'ArrowDown'].includes(e.key) || e.isComposing) return;
  e.preventDefault();
  historyIndex = Math.min(history.length, Math.max(0, historyIndex + (e.key === 'ArrowUp' ? -1 : 1)));
  $('command').value = history[historyIndex] ?? '';
});
function renderReference() {
  const query = $('search').value.trim().toLowerCase();
  const matches = commands.filter(item => item.join(' ').toLowerCase().includes(query));
  $('reference-list').replaceChildren(...matches.map(([example, description]) => {
    const card = element('article');
    card.append(element('code', example), element('p', description, 'muted'), button('填入终端', () => {
      $('command').value = example;
      $('command').focus();
    }, 'secondary'));
    return card;
  }));
  if (!matches.length) $('reference-list').append(element('p', '没有匹配的命令。', 'muted'));
}
function tab(reference) {
  $('reference-view').hidden = !reference;
  $('exercise-view').hidden = reference;
  $('reference-tab').setAttribute('aria-pressed', String(reference));
  $('exercise-tab').setAttribute('aria-pressed', String(!reference));
}
$('exercise-tab').addEventListener('click', () => tab(false));
$('reference-tab').addEventListener('click', () => tab(true));
$('search').addEventListener('input', renderReference);
for (const [value, exercise] of Object.entries(exercises)) {
  const option = element('option', exercise.title);
  option.value = value;
  $('exercise').append(option);
}
function switchWorkspace(active) {
  model.activeScenario = active;
  selected = dockerfile;
  history = [];
  historyIndex = 0;
  $('command').value = '';
  $('output').replaceChildren();
  output(active ? '已进入端口冲突练习。already-web 正在使用 8080。' : '已返回主工作区。');
  render();
}
$('exercise').addEventListener('change', () => {
  model.exercise = $('exercise').value;
  if (model.activeScenario && model.exercise !== 'conflict') switchWorkspace(false);
  text('result', '');
  $('hints').open = false;
  renderExercise();
  persist();
});
$('check').addEventListener('click', () => {
  const pending = exercises[model.exercise].steps(state(), model.activeScenario).find(step => !step.done);
  if (pending) {
    const stale = model.exercise === 'web' && pending.label.startsWith('用最新') &&
      state().containers.some(c => c.name === 'web' && c.image.id !== state().images.find(i => i.tag === 'my-web:latest')?.id);
    text('result', stale ? 'web 使用旧镜像。请停止并删除它，再用最新镜像创建容器。' : '待完成 · ' + pending.label);
  } else {
    model.completed[model.exercise] = true;
    text('result', '所有步骤检查通过。');
    persist();
    renderExercise();
  }
});
$('scenario').addEventListener('click', () => {
  if (!model.scenario) {
    model.scenario = initial();
    execute(model.scenario, 'docker run -d --name already-web -p 8080:80 nginx:alpine');
  }
  switchWorkspace(true);
  text('result', '');
  persist();
});
$('leave').addEventListener('click', () => {
  switchWorkspace(false);
  text('result', '');
  persist();
});
$('reset').addEventListener('click', () => {
  if (!confirm('重置当前工作区？这里的文件、镜像、容器和练习进度将恢复初始状态。')) return;
  if (model.activeScenario) {
    model.scenario = initial();
    execute(model.scenario, 'docker run -d --name already-web -p 8080:80 nginx:alpine');
    delete model.completed.conflict;
  } else {
    model.main = initial();
    delete model.completed.web;
    delete model.completed.lifecycle;
  }
  switchWorkspace(model.activeScenario);
  text('result', '');
  persist();
  notice('工作区已重置。');
});
const narrow = matchMedia('(max-width: 820px)');
function layout() { $('guidance').open = !narrow.matches; }
narrow.addEventListener('change', layout);
layout();
renderReference();
render();
output(model.activeScenario ? '端口冲突练习 · already-web 正在使用 8080。' : 'Docker Playground · 输入 help 查看支持的命令。');
