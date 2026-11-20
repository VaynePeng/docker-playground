const baseTags = ['alpine:3.20', 'nginx:alpine'];
const tagOf = name => name.split('/').at(-1).includes(':') ? name : name + ':latest';
const imageTag = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[\w][\w.-]*)?$/;
const has = (obj, key) => Object.hasOwn(obj, key);
const fail = message => { throw new Error(message); };

export function initial() {
  return {
    cwd: '/workspace',
    files: {
      '/workspace': { type: 'dir' },
      '/workspace/Dockerfile': { type: 'file', content: 'FROM nginx:alpine\n\n# 使用 COPY 将 index.html 加入镜像\n' },
      '/workspace/index.html': { type: 'file', content: '<!doctype html>\n<h1>Hello from Docker!</h1>\n' }
    },
    drafts: {}, images: baseTags.map((tag, index) => ({ tag, id: 'base' + index })),
    containers: [], events: [], nextId: 1
  };
}
const parent = path => path.slice(0, path.lastIndexOf('/')) || '/';
function absolute(raw) {
  const parts = [];
  for (const part of raw.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}
export function pathFor(state, input = '.', cwd = state.cwd) {
  const path = absolute(input.startsWith('/') ? input : cwd + '/' + input);
  if (path !== '/workspace' && !path.startsWith('/workspace/')) fail('路径必须位于 /workspace 内。');
  return path;
}
export function addEntry(state, path, type) {
  if (has(state.files, path)) fail('路径已存在：' + path);
  if (state.files[parent(path)]?.type !== 'dir') fail('父目录不存在：' + parent(path));
  state.files[path] = type === 'dir' ? {type} : {type, content: ''};
}
export function changeEntry(state, from, to) {
  if (from === '/workspace') fail('无法更改工作区根目录。');
  if (to === from) return;
  if (to && (has(state.files, to) || to.startsWith(from + '/') || state.files[parent(to)]?.type !== 'dir')) {
    fail('目标路径不可用：' + to);
  }
  for (const key of Object.keys(state.files)) {
    if (key !== from && !key.startsWith(from + '/')) continue;
    if (to) {
      const destination = to + key.slice(from.length);
      state.files[destination] = state.files[key];
      if (has(state.drafts, key)) state.drafts[destination] = state.drafts[key];
    }
    delete state.files[key];
    delete state.drafts[key];
  }
  if (state.cwd === from || state.cwd.startsWith(from + '/')) state.cwd = to ? to + state.cwd.slice(from.length) : parent(from);
}
function tokens(line) {
  const args = [];
  let value = '', quote = '', started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\' && quote !== "'") {
      if (++i >= line.length) fail('缺少转义字符。');
      value += line[i];
    } else if (quote) {
      if (char === quote) quote = '';
      else value += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (started) args.push(value);
      value = '';
      started = false;
      continue;
    } else {
      value += char;
    }
    started = true;
  }
  if (quote) fail('引号未闭合。');
  if (started) args.push(value);
  return args;
}
const idFor = state => (state.nextId++).toString(16).padStart(12, '0');
const portNumber = value => /^\d+$/.test(value) && +value >= 1 && +value <= 65535;
const containerTable = list => ['CONTAINER ID  NAME  IMAGE  STATUS  PORTS', ...list.map(c => [
  c.id, c.name, c.image.tag, c.running ? 'Up' : 'Exited (0)', c.port ? c.port.join(' → ') : '—'
].join('  '))].join('\n');

export function readDockerfile(state, context = state.cwd) {
  const file = state.files[context + '/Dockerfile'];
  if (file?.type !== 'file') fail('找不到 Dockerfile：' + context);
  const source = file.content;
  const copied = {};
  const exposed = [];
  let base, workdir = '/', command;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const [instruction, ...args] = tokens(line.trim());
    const error = message => fail('Dockerfile 第 ' + (index + 1) + ' 行：' + message);
    const op = instruction.toUpperCase();
    if (op !== 'FROM' && !base) error('请先指定 FROM。');
    switch (op) {
      case 'FROM':
        if (base || args.length !== 1 || !baseTags.includes(args[0])) error('请使用单阶段 FROM nginx:alpine 或 FROM alpine:3.20。');
        base = args[0];
        break;
      case 'WORKDIR':
        if (args.length !== 1 || !args[0]) error('需要一个工作目录。');
        workdir = absolute(args[0].startsWith('/') ? args[0] : workdir + '/' + args[0]);
        break;
      case 'COPY': {
        if (args.length !== 2 || args.some(arg => !arg || arg.startsWith('--'))) error('目前仅支持 COPY <单个本地文件> <目标路径>。');
        const input = pathFor(state, args[0], context);
        if (!input.startsWith(context + '/') || state.files[input]?.type !== 'file') error('构建上下文中找不到源文件 ' + args[0]);
        const output = args[1].startsWith('/') ? args[1] : workdir + '/' + args[1];
        const destination = absolute(output.endsWith('/') ? output + input.split('/').at(-1) : output);
        copied[destination] = { input, content: state.files[input].content };
        break;
      }
      case 'EXPOSE':
        if (!args.length || args.some(arg => !portNumber(arg))) error('请指定 1 到 65535 的 TCP 端口。');
        exposed.push(...args.map(Number));
        break;
      case 'CMD':
        try { command = JSON.parse(line.trim().replace(/^CMD\s+/i, '')); } catch { error('CMD 需要 JSON 字符串数组。'); }
        if (!Array.isArray(command) || !command.length || !command.every(value => typeof value === 'string')) error('CMD 需要 JSON 字符串数组。');
        break;
      default:
        error('模拟环境暂不支持 ' + op);
    }
  }
  if (!base) fail('Dockerfile 缺少 FROM。');
  return { source, context, base, copied, exposed, command, workdir };
}
function portBusy(state, port) {
  return port && state.containers.find(c => c.running && c.port?.[0] === port[0]);
}
function event(state, action, container, extra = {}) {
  state.events.push({ action, id: container.id, name: container.name, ...extra });
}
export const commands = [
  ['docker ps', '查看运行中的容器'],
  ['docker ps -a', '查看所有容器，包括已停止的容器'],
  ['docker images', '查看镜像'],
  ['docker build -t my-web .', '使用当前目录的 Dockerfile 构建镜像'],
  ['docker run -d --name web -p 8080:80 my-web', '运行容器并映射端口'],
  ['docker run -d --name demo alpine:3.20', '从内置 Alpine 镜像启动容器'],
  ['docker stop web', '停止指定容器'],
  ['docker start web', '重新启动容器'],
  ['docker rm web', '删除已停止的容器'],
  ['docker logs web', '查看容器的模拟日志'],
  ['ls', '列出工作目录内容'],
  ['pwd', '显示工作目录'],
  ['cd /workspace', '切换工作目录'],
  ['cat Dockerfile', '读取文件保存后的内容'],
  ['mkdir src', '创建虚拟目录'],
  ['touch src/app.txt', '创建虚拟文件'],
  ['clear', '清空终端输出'],
  ['help', '显示支持的命令']
];

export function execute(state, line) {
  const [command, ...args] = tokens(line);
  const [first] = args;
  if (!command) return '';
  if (command === 'docker') return docker(state, args);
  const exact = { pwd: 0, cd: 1, cat: 1, mkdir: 1, touch: 1, clear: 0, help: 0 };
  if (has(exact, command) && exact[command] !== args.length || command === 'ls' && args.length > 1) fail('参数错误，输入 help 查看用法。');
  switch (command) {
    case 'help': return commands.map(([example, description]) => example + '  ·  ' + description).join('\n');
    case 'clear': return null;
    case 'pwd': return state.cwd;
    case 'ls': {
      const path = pathFor(state, first);
      const node = state.files[path];
      if (!node) fail('路径不存在：' + path);
      return node.type === 'file' ? path.split('/').at(-1) : Object.keys(state.files)
        .filter(key => parent(key) === path).sort()
        .map(key => key.split('/').at(-1) + (state.files[key].type === 'dir' ? '/' : '')).join('  ');
    }
    case 'cd': {
      const path = pathFor(state, first);
      if (state.files[path]?.type !== 'dir') fail('目录不存在：' + path);
      state.cwd = path;
      return '';
    }
    case 'cat': {
      const path = pathFor(state, first);
      if (state.files[path]?.type !== 'file') fail('文件不存在：' + path);
      return state.files[path].content;
    }
    case 'mkdir': addEntry(state, pathFor(state, first), 'dir'); return '';
    case 'touch': {
      const path = pathFor(state, first);
      if (state.files[path]?.type !== 'file') addEntry(state, path, 'file');
      return '';
    }
    default: fail('模拟终端不支持该命令。输入 help 查看可用命令。');
  }
}
function docker(state, [operation, ...args]) {
  if (operation === 'ps' && (!args.length || args.length === 1 && args[0] === '-a')) {
    const list = args.length ? state.containers : state.containers.filter(c => c.running);
    event(state, 'ps', {}, { ids: list.map(c => c.id) });
    return containerTable(list);
  }
  if (operation === 'images' && !args.length) return ['IMAGE  IMAGE ID', ...state.images.map(image => image.tag + '  ' + image.id)].join('\n');
  if (operation === 'build' && args.length === 3 && args[0] === '-t' && args[2] === '.' && imageTag.test(args[1])) {
    const tag = tagOf(args[1]);
    if (baseTags.includes(tag)) fail('这个标签保留给内置镜像。请选择其他标签。');
    const image = { ...readDockerfile(state), id: idFor(state), tag };
    state.images = [...state.images.filter(item => item.tag !== tag), image];
    return 'Successfully built ' + image.id + '\nSuccessfully tagged ' + tag;
  }
  if (operation === 'run') {
    const imageName = args.at(-1);
    let name, port, detached = false;
    for (let index = 0; index < args.length - 1; index++) {
      const flag = args[index];
      if (flag === '-d' && !detached) detached = true;
      else if (flag === '--name' && !name && index + 1 < args.length - 1) name = args[++index];
      else if (flag === '-p' && !port && index + 1 < args.length - 1) {
        const parts = args[++index].split(':');
        if (parts.length !== 2 || !parts.every(portNumber)) fail('端口格式为 <宿主端口>:<容器端口>。');
        port = parts.map(Number);
      } else fail('不支持的 docker run 参数：' + flag);
    }
    if (!detached || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name || '') || !imageName || !imageTag.test(imageName)) {
      fail('用法：docker run -d --name <名称> [-p <宿主端口>:<容器端口>] <镜像>');
    }
    if (state.containers.some(c => c.name === name)) fail('容器名已存在：' + name);
    const image = state.images.find(item => item.tag === tagOf(imageName));
    if (!image) fail('找不到镜像：' + imageName);
    const conflict = portBusy(state, port);
    if (conflict) {
      event(state, 'conflict', {name}, { port: port[0], occupiedBy: conflict.name });
      fail('宿主端口 ' + port[0] + ' 已被 ' + conflict.name + ' 占用。');
    }
    const container = { id: idFor(state), name, image, port, running: true, logs: ['容器已启动（模拟）'] };
    state.containers.push(container);
    event(state, 'run', container);
    return container.id;
  }
  if (['start', 'stop', 'rm', 'logs'].includes(operation) && args.length === 1) {
    const container = state.containers.find(c => c.name === args[0] || c.id === args[0]);
    if (!container) fail('找不到容器：' + args[0]);
    if (operation === 'logs') return container.logs.join('\n');
    if (operation === 'rm') {
      if (container.running) fail('请先停止运行中的容器。');
      state.containers = state.containers.filter(c => c.id !== container.id);
    } else {
      const running = operation === 'start';
      if (container.running === running) return container.name;
      const conflict = running && portBusy(state, container.port);
      if (conflict) fail('宿主端口 ' + container.port[0] + ' 已被 ' + conflict.name + ' 占用。');
      container.running = running;
      container.logs.push(running ? '容器已重新启动（模拟）' : '容器已停止（模拟）');
    }
    event(state, operation, container);
    return container.name;
  }
  fail('Docker 命令或参数不受支持。输入 help 查看用法。');
}
