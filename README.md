# Docker Playground

面向 Docker 初学者的浏览器工作区。上方展示容器状态，中间编辑 Dockerfile 和虚拟文件，下方运行命令，右侧提供练习、提示和命令速查。

## 本地运行

无需 Docker 或 npm 依赖。在仓库根目录运行：

```sh
python3 -m http.server 8000 --directory dist
```

打开 http://localhost:8000。终端中输入 `help` 可查看支持的命令。

## 第一题

在 Dockerfile 中加入下面一行并保存：

```dockerfile
COPY index.html /usr/share/nginx/html/index.html
```

在页面的模拟终端运行：

```sh
docker build -t my-web .
docker run -d --name web -p 8080:80 my-web
```

容器列表会显示 `web`，可在右侧检查练习结果。

## 模拟范围

终端支持有限的 Docker 和文件命令。内置镜像和日志由浏览器模拟，端口映射用于练习状态和冲突检测。文件、草稿、镜像、容器和练习进度保存于当前浏览器。

- [产品需求文档](docs/PRD.md)
- [桌面原型图](docs/prototype.png)
