import { readDockerfile } from './engine.mjs';

const checks = (labels, values) => labels.map((label, index) => ({ label, done: Boolean(values[index]) }));
const webPath = '/usr/share/nginx/html/index.html';
const webPage = image => image?.base === 'nginx:alpine' && image.copied[webPath]?.input === '/workspace/index.html';

export const exercises = {
  web: {
    title: '构建并运行网页',
    goal: '把 index.html 加入镜像，再用镜像启动 web 容器。',
    hints: [
      '在 Dockerfile 中加入 COPY index.html /usr/share/nginx/html/index.html 并保存。',
      '运行 docker build -t my-web .',
      '运行 docker run -d --name web -p 8080:80 my-web'
    ],
    steps(state) {
      let config;
      try { config = readDockerfile(state, '/workspace'); } catch { /* An incomplete Dockerfile is expected during this exercise. */ }
      const configured = webPage(config);
      const image = state.images.find(item => item.tag === 'my-web:latest');
      const built = configured && webPage(image) && image.source === config.source &&
        image.copied[webPath].content === config.copied[webPath].content;
      const running = built && state.containers.some(c => c.name === 'web' && c.running &&
        c.image.id === image.id && c.port?.[0] === 8080 && c.port?.[1] === 80);
      return checks(
        ['保存包含页面的 Dockerfile', '用当前文件构建 my-web 镜像', '用最新镜像启动 web，映射 8080:80'],
        [configured, built, running]
      );
    }
  },
  lifecycle: {
    title: '管理容器生命周期',
    goal: '启动 demo，查看列表，停止并删除这个容器。',
    hints: [
      'docker run -d --name demo alpine:3.20',
      'docker ps',
      'docker stop demo，再运行 docker rm demo'
    ],
    steps(state) {
      const candidates = state.events.filter(e => e.action === 'run' && e.name === 'demo');
      const viewed = candidates.filter(c => state.events.some(e => e.action === 'ps' && e.ids.includes(c.id)));
      const stopped = viewed.filter(c => state.events.some(e => e.action === 'stop' && e.id === c.id));
      const removed = stopped.some(c => state.events.some(e => e.action === 'rm' && e.id === c.id));
      return checks(['启动 demo', '在列表中看到 demo', '停止 demo', '删除 demo'], [candidates.length, viewed.length, stopped.length, removed]);
    }
  },
  conflict: {
    title: '排查端口冲突',
    goal: '在独立练习环境中先尝试占用 8080，再让两个容器各用一个宿主端口。',
    hints: [
      '预置容器 already-web 正在占用宿主端口 8080。',
      '先运行 docker run -d --name other-web -p 8080:80 nginx:alpine 观察错误。',
      '将 other-web 的宿主端口改为 8081，保留映射的容器端口 80。'
    ],
    steps(state, scenario) {
      const clash = scenario && state.events.some(e => e.action === 'conflict' && e.name === 'other-web' &&
        e.occupiedBy === 'already-web' && e.port === 8080);
      const existing = state.containers.find(c => c.name === 'already-web' && c.running && c.port?.[0] === 8080);
      const other = state.containers.find(c => c.name === 'other-web' && c.running &&
        c.port?.[1] === 80 && c.port?.[0] !== 8080);
      return checks(['进入预置练习环境', '复现 8080 端口冲突', '两个容器使用不同端口运行'], [scenario, clash, scenario && existing && other]);
    }
  }
};
