# Air 准备与原生工具授权阻碍

日期：2026年10月26日。

状态：包传输与严格验签已完成，Air原生应用验收等待用户处理Computer Use工具授权。本文不是原生界面通过报告。

## 产物与传输核对

唯一传输的产品产物是主控已生成的完整ZIP；没有复制仓库或Documents目录内的原始.app，也没有重新打包。

- ZIP：`深圳骑行地图-macOS-arm64.zip`。
- Studio源路径：`/Users/zhousefu/Documents/Codex/2026-10-08/http-localhost-3700-http-localhost-3700/outputs/深圳骑行地图/desktop-dist/深圳骑行地图-macOS-arm64.zip`。
- Studio与Air现场读取的字节数均为`231673743`。
- Studio与Air现场计算的SHA-256均为`3bd83d77aab96098217cbb225b5ecc8be658d4b755db1ce46db78972afe676e8`。
- 主控提供的源代码SHA：`477f71e708baf15d5729ecd2bdea88276bfb0615`。
- 主控提供的构建参数：Electron45.0.0、darwin-arm64、ad-hoc签名，未公证。
- Air包路径：`/Users/zhousefu/shenzhen-desktop-acceptance/package-477f71e708ba.zip`。
- Air解出应用路径：`/Users/zhousefu/shenzhen-desktop-acceptance/build-477f71e708ba/深圳骑行地图.app`。
- 解包前检查目标构建目录与ZIP均不存在；没有覆盖旧产物。本轮开始前应用userData目录不存在，没有清空任何既有存档。

## Air严格代码签名

Air实际执行：

```sh
/usr/bin/codesign --verify --deep --strict --verbose=2 "/Users/zhousefu/shenzhen-desktop-acceptance/build-477f71e708ba/深圳骑行地图.app"
```

命令退出状态为0。最终实际输出：

```text
/Users/zhousefu/shenzhen-desktop-acceptance/build-477f71e708ba/深圳骑行地图.app: valid on disk
/Users/zhousefu/shenzhen-desktop-acceptance/build-477f71e708ba/深圳骑行地图.app: satisfies its Designated Requirement
```

通过PlistBuddy读取的`CFBundleIdentifier`为`studio.shenzhen.delivery`。

## 验收会话与真实授权提示

经Studio专用入口`macbook-ui-test`创建了单个Air原生Codex验收会话`shenzhen-desktop-air`，标签为“深圳离线应用验收”。启动回读为GPT-6.1 Sol、xhigh、Fast。

Air实际原生`computer`工具已被调用：首次读取Computer Use工具说明与可用桌面，随后请求观察“深圳骑行地图”的原生窗口。该请求出现如下交互授权，当前仍停在这里：

```text
Allow Computer Use to use "深圳骑行地图"?

App: 深圳骑行地图

1. Allow
2. Allow for this session
3. Always allow
4. Cancel
```

本轮没有用按键、提示词或其他工具代替用户选择Allow，没有自动授予应用控制或系统权限，也没有用浏览器/CDP观察来绕过此原生工具授权。

首次LaunchServices启动命令返回-10827。随后只读确认应用可执行文件存在且有执行权限，第二次`open`命令退出0。该结果仅表示启动命令没有报错，不能代表已看到原生窗口、字体或三维地图。

主控已将准确授权来源和可选处理方式告知用户。用户随后明确回复“我已在Air允许本次会话，继续验收”，任务权限已经确认，不需要重复讨论。收到回复后，验收协调者先重新start独立marker，再现场读取同一Air会话，实际CLI状态仍为blocked，原Computer Use提示仍显示“enter to submit”。因此当前问题是该CLI提示尚未实际提交放行，不是缺少用户口头授权。主控已请用户在同一提示中选择Allow for this session并按Enter。

## 暂停期间的标记与保留状态

Air缺少全局`auto-verify-mark`工具。本轮只复制Studio官方脚本到任务目录`/Users/zhousefu/shenzhen-desktop-acceptance/tools/auto-verify-mark.py`，使用任务独立文件`/Users/zhousefu/shenzhen-desktop-acceptance/automation-marker.json`，没有安装全局脚本或修改用户设置。

进入原生验收前已start。因工具授权等待而暂停后，先核对marker归属为`shenzhen-desktop-air`，再按主控要求stop，最后实际回读：

```text
已停止自动验收，标记已删除：/Users/zhousefu/shenzhen-desktop-acceptance/automation-marker.json
标记：/Users/zhousefu/shenzhen-desktop-acceptance/automation-marker.json
状态：不存在
```

Air验收会话与本次应用仍保留，未关闭用户其他窗口或服务。恢复原生操作前必须重新start该任务标记。暂停后没有继续处理原生权限，没有向Air agent发送普通prompt。

## 未完成的原生验收

以下均未通过本轮原生窗口验证，不能从包哈希、代码签名、协议测试、进程存在或open退出0推断为完成：

- 原生窗口实际显示深圳三维地图、中文字体和两平台骑手。
- 平台切换和完整90秒试跑。
- 原生关闭窗口后点击Dock重开，且页面`performance.timeOrigin`保持不变。
- 真实Cmd+Q退出后重新启动，模式与配送进度恢复。
- Electron内置资源在离线模式下reload并完整显示。
- 应用内旧骑行入口和GPX导出。

下一步等待同一Air CLI提示实际放行；不再询问用户权限范围，不代按审批按键、不新建验收会话。第二次恢复尝试后，按主控要求再次stop任务独立marker，并现场回读状态为不存在。
