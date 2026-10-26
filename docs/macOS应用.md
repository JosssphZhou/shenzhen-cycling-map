# macOS离线应用

桌面版沿用当前网页、Factory界面和三维城市，用Electron承载。页面、全部城市分块、原始回退数据、路网、字体和轨迹放在应用包里，经本地协议读取；无需启动开发服务器或连接外网。

关闭窗口会保留场景，通过Dock或“窗口 → 显示地图”恢复。使用Command-Q真正退出；下次打开时会重新初始化本地三维画面，正常专注和试玩的进度从应用存档恢复。

应用数据保存在`~/Library/Application Support/shenzhen-delivery-desktop/`，与应用文件分开。应用使用独立存档，网页版进度不会自动迁入；现有浏览器存档没有改动。

## 重新打包

需要macOS、Node.js 22.12或更新版本。首次安装工具及Electron运行时需要联网，成品运行无需联网。

```sh
npm ci
npm run desktop:build
```

已有最新`out/`时，可执行`npm run desktop:package`复用现成网页。产物位于`desktop-dist/`，不提交到Git。包内只保留压缩资源或小文件原件，读取时透明解压，避免同时附带两份数据。

本地资源协议测试：

```sh
npm run desktop:test
```

## 验证范围

协议测试检查压缩HTML和JSON能按原URL读取、同名RSC目录不覆盖页面、HEAD和404正确，并拒绝越界、错误域名及写入请求。这是新桌面传输契约，没有修复前红灯；现有网页检查无法覆盖这个协议。两条测试都调用实际使用的资源处理器，没有测试专用生产开关。

原生应用的实际运行、离线、关闭恢复和退出后存档验证，结果记录在[macOS应用验证目录](验证证据/macOS离线应用/)。只把实际完成的项目记为通过。

本轮生成本机体验包，使用临时签名，不执行正式签名、公证或对外发布。正式分发另行处理。

实现依据：[Electron本地协议](https://www.electronjs.org/docs/latest/api/protocol/)、[Electron应用打包](https://www.electronjs.org/docs/latest/tutorial/application-distribution)。
